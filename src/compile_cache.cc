#include "compile_cache.h"
#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_file.h"
#include "node_internals.h"
#include "node_version.h"
#include "zlib.h"

namespace node {
std::string Uint32ToHex(uint32_t crc) {
  std::string str;
  str.reserve(8);

  for (int i = 28; i >= 0; i -= 4) {
    char digit = (crc >> i) & 0xF;
    digit += digit < 10 ? '0' : 'a' - 10;
    str.push_back(digit);
  }

  return str;
}

// TODO(joyeecheung): use other hashes?
uint32_t GetHash(const char* data, size_t size) {
  uLong crc = crc32(0L, Z_NULL, 0);
  return crc32(crc, reinterpret_cast<const Bytef*>(data), size);
}

uint32_t GetCacheVersionTag() {
  std::string node_version(NODE_VERSION);
  uint32_t v8_tag = v8::ScriptCompiler::CachedDataVersionTag();
  uLong crc = crc32(0L, Z_NULL, 0);
  crc = crc32(crc, reinterpret_cast<const Bytef*>(&v8_tag), sizeof(uint32_t));
  crc = crc32(crc,
              reinterpret_cast<const Bytef*>(node_version.data()),
              node_version.size());
  return crc;
}

uint32_t GetCacheKey(std::string_view filename, CachedCodeType type) {
  uLong crc = crc32(0L, Z_NULL, 0);
  crc = crc32(crc, reinterpret_cast<const Bytef*>(&type), sizeof(type));
  crc = crc32(
      crc, reinterpret_cast<const Bytef*>(filename.data()), filename.length());
  return crc;
}

template <typename... Args>
inline void CompileCacheHandler::Debug(const char* format,
                                       Args&&... args) const {
  if (UNLIKELY(is_debug_)) {
    FPrintF(stderr, format, std::forward<Args>(args)...);
  }
}

v8::ScriptCompiler::CachedData* CompileCacheEntry::CopyCache() const {
  CHECK_NOT_NULL(cache);
  int cache_size = cache->length;
  uint8_t* data = new uint8_t[cache_size];
  memcpy(data, cache->data, cache_size);
  return new v8::ScriptCompiler::CachedData(
      data, cache_size, v8::ScriptCompiler::CachedData::BufferOwned);
}

int CompileCacheHandler::ReadCacheFile(const char* path,
                                       uint32_t expected_code_size,
                                       uint32_t expected_code_hash,
                                       uint32_t* headers,
                                       uint8_t** cache_data,
                                       size_t* cache_size,
                                       bool* is_header_mismatch) {
  uv_fs_t req;
  auto defer_req_cleanup = OnScopeLeave([&req]() { uv_fs_req_cleanup(&req); });

  uv_file file = uv_fs_open(nullptr, &req, path, O_RDONLY, 0, nullptr);
  if (req.result < 0) {
    // req will be cleaned up by scope leave.
    return req.result;
  }
  uv_fs_req_cleanup(&req);

  auto defer_close = OnScopeLeave([file]() {
    uv_fs_t close_req;
    CHECK_EQ(0, uv_fs_close(nullptr, &close_req, file, nullptr));
    uv_fs_req_cleanup(&close_req);
  });

  uv_buf_t headers_buf = uv_buf_init(reinterpret_cast<char*>(headers),
                                     kHeaderCount * sizeof(uint32_t));
  const int r = uv_fs_read(nullptr, &req, file, &headers_buf, 1, 0, nullptr);
  if (r != static_cast<int>(headers_buf.len)) {
    *is_header_mismatch = true;
    Debug("reading header failed, bytes read %d", r);
    if (req.result < 0 && is_debug_) {
      Debug(", %s", uv_strerror(req.result));
    }
    Debug("\n");
    return req.result < 0 ? req.result : -1;
  }
  if (headers[kCodeSizeOffset] != expected_code_size) {
    *is_header_mismatch = true;
    Debug("code size mismatch: expected %d, actual %d\n",
          expected_code_size,
          headers[kCodeSizeOffset]);
    return -1;
  }
  if (headers[kCodeHashOffset] != expected_code_hash) {
    *is_header_mismatch = true;
    Debug("code hash mismatch: expected %d, actual %d\n",
          expected_code_hash,
          headers[kCodeHashOffset]);
    return -1;
  }

  size_t offset = headers_buf.len;
  size_t capacity = 4096;  // Initial buffer capacity
  size_t total_read = 0;
  uint8_t* buffer = new uint8_t[capacity];

  while (true) {
    // Ensure there is space to read more data. Grow exponentially.
    if (total_read == capacity) {
      size_t new_capacity = capacity * 2;
      auto* new_buffer = new uint8_t[new_capacity];
      memcpy(new_buffer, buffer, capacity);
      delete[] buffer;
      buffer = new_buffer;
      capacity = new_capacity;
    }

    // Read into buffer.
    uv_buf_t iov = uv_buf_init(reinterpret_cast<char*>(buffer + total_read),
                               capacity - total_read);
    int bytes_read =
        uv_fs_read(nullptr, &req, file, &iov, 1, offset + total_read, nullptr);
    if (req.result < 0) {  // Error.
      // req will be cleaned up by scope leave.
      delete[] buffer;
      return req.result;
    }
    uv_fs_req_cleanup(&req);
    if (bytes_read <= 0) {
      break;
    }
    total_read += bytes_read;
  }

  *cache_data = buffer;
  *cache_size = total_read;
  return 0;
}

CompileCacheEntry* CompileCacheHandler::Get(v8::Local<v8::String> code,
                                            v8::Local<v8::String> filename,
                                            CachedCodeType type) {
  DCHECK(!compile_cache_dir_.empty());

  Utf8Value filename_utf8(isolate_, filename);
  uint32_t key = GetCacheKey(filename_utf8.ToStringView(), type);

  auto loaded = compiler_cache_store_.find(key);
  if (loaded != compiler_cache_store_.end()) {
    return loaded->second.get();
  }

  auto emplaced =
      compiler_cache_store_.emplace(key, std::make_unique<CompileCacheEntry>());
  auto* result = emplaced.first->second.get();
  // TODO(joyeecheung): don't decode this. If we read the content on disk as raw
  // buffer, we can just hash it directly.
  Utf8Value code_utf8(isolate_, code);
  result->code_hash = GetHash(code_utf8.out(), code_utf8.length());
  result->code_size = code_utf8.length();
  result->cache_key = key;
  result->cache_filename =
      compile_cache_dir_ + kPathSeparator + Uint32ToHex(result->cache_key);
  result->source_filename = filename_utf8.ToString();
  result->cache = nullptr;
  result->type = type;

  Debug("[compile cache] reading cache from %s for %s %s...",
        result->cache_filename,
        type == CachedCodeType::kCommonJS ? "CommonJS" : "ESM",
        result->source_filename);
  // TODO(joyeecheung): if we fail enough times, stop trying for any future
  // files.
  std::string code_cache_store;

  std::vector<uint32_t> headers(kHeaderCount);
  uint8_t* cache_data = nullptr;
  size_t cache_size = 0;
  bool is_header_mismatch = false;
  int err = ReadCacheFile(result->cache_filename.c_str(),
                          result->code_size,
                          result->code_hash,
                          headers.data(),
                          &cache_data,
                          &cache_size,
                          &is_header_mismatch);
  if (is_header_mismatch) {
    return result;
  }
  if (err < 0) {
    if (is_debug_) {
      Debug(" %s\n", uv_strerror(err));
    }
    return result;
  }

  if (headers[kCacheSizeOffset] != cache_size) {
    Debug("cache size mismatch: expected %d, actual %d\n",
          headers[kCacheSizeOffset],
          cache_size);
    return result;
  }
  uint32_t cache_hash =
      GetHash(reinterpret_cast<char*>(cache_data), cache_size);

  if (headers[kCacheHashOffset] != cache_hash) {
    Debug("cache hash mismatch: expected %d, actual %d\n",
          headers[kCacheHashOffset],
          cache_hash);
    return result;
  }

  result->cache.reset(new v8::ScriptCompiler::CachedData(
      cache_data, cache_size, v8::ScriptCompiler::CachedData::BufferOwned));
  Debug(" success, size=%d\n", cache_size);

  return result;
}

v8::ScriptCompiler::CachedData* SerializeCodeCache(
    v8::Local<v8::Function> func) {
  return v8::ScriptCompiler::CreateCodeCacheForFunction(func);
}

v8::ScriptCompiler::CachedData* SerializeCodeCache(v8::Local<v8::Module> mod) {
  return v8::ScriptCompiler::CreateCodeCache(mod->GetUnboundModuleScript());
}

template <typename T>
void CompileCacheHandler::MaybeSaveImpl(CompileCacheEntry* entry,
                                        v8::Local<T> func_or_mod,
                                        bool rejected) {
  DCHECK_NOT_NULL(entry);
  Debug("[compile cache] cache for %s was %s, ",
        entry->source_filename,
        rejected                    ? "rejected"
        : (entry->cache == nullptr) ? "not initialized"
                                    : "accepted");
  if (entry->cache != nullptr && !rejected) {  // accepted
    Debug("keeping the in-memory entry\n");
    return;
  }
  Debug("%s the in-memory entry\n",
        entry->cache == nullptr ? "initializing" : "refreshing");

  v8::ScriptCompiler::CachedData* data = SerializeCodeCache(func_or_mod);
  DCHECK_EQ(data->buffer_policy, v8::ScriptCompiler::CachedData::BufferOwned);
  entry->refreshed = true;
  entry->cache.reset(data);
}

void CompileCacheHandler::MaybeSave(CompileCacheEntry* entry,
                                    v8::Local<v8::Module> mod,
                                    bool rejected) {
  DCHECK(mod->IsSourceTextModule());
  MaybeSaveImpl(entry, mod, rejected);
}

void CompileCacheHandler::MaybeSave(CompileCacheEntry* entry,
                                    v8::Local<v8::Function> func,
                                    bool rejected) {
  MaybeSaveImpl(entry, func, rejected);
}

void CompileCacheHandler::Persist() {
  DCHECK(!compile_cache_dir_.empty());
  for (auto& pair : compiler_cache_store_) {
    auto* entry = pair.second.get();
    if (entry->cache == nullptr) {
      Debug("[compile cache] skip %s because the cache was not initialized\n",
            entry->source_filename);
      continue;
    }
    if (entry->refreshed == false) {
      Debug("[compile cache] skip %s because cache was the same\n",
            entry->source_filename);
      continue;
    }

    CHECK_EQ(entry->cache->buffer_policy,
             v8::ScriptCompiler::CachedData::BufferOwned);
    char* cache_ptr =
        reinterpret_cast<char*>(const_cast<uint8_t*>(entry->cache->data));
    size_t cache_size = entry->cache->length;
    uint32_t cache_hash = GetHash(cache_ptr, cache_size);

    Debug("[compile cache] writing cache for %s in %s, code hash = %d, cache "
          "hash = %d, code size %d, cache_size %d...",
          entry->source_filename,
          entry->cache_filename,
          entry->code_hash,

          cache_hash);
    std::vector<char> headers(kHeaderCount * sizeof(uint32_t));
    memcpy(headers.data() + kCodeHashOffset * sizeof(uint32_t),
           &(entry->code_hash),
           sizeof(entry->code_hash));
    memcpy(headers.data() + kCacheHashOffset * sizeof(uint32_t),
           &(cache_hash),
           sizeof(cache_hash));

    uv_buf_t headers_buf = uv_buf_init(headers.data(), headers.size());
    uv_buf_t data_buf = uv_buf_init(cache_ptr, entry->cache->length);
    uv_buf_t bufs[] = {headers_buf, data_buf};
    int err = WriteFileSync(entry->cache_filename.c_str(), bufs, 2);
    if (is_debug_) {
      Debug("%s\n", err < 0 ? uv_strerror(err) : "success");
    }
  }
}

CompileCacheHandler::CompileCacheHandler(Environment* env)
    : isolate_(env->isolate()),
      is_debug_(
          env->enabled_debug_list()->enabled(DebugCategory::COMPILE_CACHE)) {}

// Directory structure:
// - Compile cache directory (from NODE_COMPILE_CACHE)
//   - <cache_version_tag_1>: tag is a hash of CachedDataVersionTag() +
//   NODE_VERSION
//   - <cache_version_tag_2>
//   - <cache_version_tag_3>
//     - <cache_file_1>: a hash of filename + module type
//     - <cache_file_2>
//     - <cache_file_3>
bool CompileCacheHandler::InitializeDirectory(const std::string& dir) {
  compiler_cache_key_ = GetCacheVersionTag();
  std::string cache_dir =
      dir + kPathSeparator + Uint32ToHex(compiler_cache_key_);

  fs::FSReqWrapSync req_wrap;
  int err = fs::MKDirpSync(nullptr, &(req_wrap.req), cache_dir, 0777, nullptr);
  if (is_debug_) {
    Debug("[compile cache] creating cache directory %s...%s\n",
          cache_dir,
          err < 0 ? uv_strerror(err) : "success");
  }
  if (err != 0 && err != UV_EEXIST) {
    return false;
  }

  uv_fs_t req;
  auto clean = OnScopeLeave([&req]() { uv_fs_req_cleanup(&req); });
  // TODO(joyeecheung): use something cheaper.
  err = uv_fs_realpath(nullptr, &req, cache_dir.data(), nullptr);
  if (is_debug_) {
    Debug("[compile cache] resolving real path %s...%s\n",
          cache_dir,
          err < 0 ? uv_strerror(err) : "success");
  }
  if (err != 0 && err != UV_ENOENT) {
    return false;
  }

  compile_cache_dir_ = std::string(static_cast<char*>(req.ptr));
  Debug("[compile cache] resolved real path %s -> %s\n",
        cache_dir,
        compile_cache_dir_);
  return true;
}

}  // namespace node
