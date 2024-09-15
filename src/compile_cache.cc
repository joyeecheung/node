#include "compile_cache.h"
#include <string>
#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_file.h"
#include "node_internals.h"
#include "node_version.h"
#include "path.h"
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

std::string GetCacheVersionTag() {
  // On platforms where uids are available, use different folders for
  // different users to avoid cache miss due to permission incompatibility.
  // On platforms where uids are not available, bare with the cache miss.
  // This should be fine on Windows, as there local directories tend to be
  // user-specific.
  std::string tag = std::string(NODE_VERSION) + '-' + std::string(NODE_ARCH) +
                    '-' +
                    Uint32ToHex(v8::ScriptCompiler::CachedDataVersionTag());
#ifdef NODE_IMPLEMENTS_POSIX_CREDENTIALS
  tag += '-' + std::to_string(getuid());
#endif
  return tag;
}

uint32_t GetCacheKey(std::string_view filename, CachedCodeType type) {
  uLong crc = crc32(0L, Z_NULL, 0);
  crc = crc32(crc, reinterpret_cast<const Bytef*>(&type), sizeof(type));
  crc = crc32(
      crc, reinterpret_cast<const Bytef*>(filename.data()), filename.length());
  return crc;
}

template <typename... Args>
void Debug(bool is_debug, const char* format, Args&&... args) {
  if (UNLIKELY(is_debug)) {
    FPrintF(stderr, format, std::forward<Args>(args)...);
  }
}

template <typename... Args>
inline void CompileCacheHandler::Debug(const char* format,
                                       Args&&... args) const {
  Debug(is_debug_, format, std::forward<Args>(args)...);
}

v8::ScriptCompiler::CachedData* CompileCacheEntry::CopyCache() const {
  DCHECK_NOT_NULL(cache);
  int cache_size = cache->length;
  uint8_t* data = new uint8_t[cache_size];
  memcpy(data, cache->data, cache_size);
  return new v8::ScriptCompiler::CachedData(
      data, cache_size, v8::ScriptCompiler::CachedData::BufferOwned);
}

// Used for identifying and verifying a file is a compile cache file.
// See comments in CompileCacheHandler::Persist().
constexpr uint32_t kCacheMagicNumber = 0x8adfdbb2;

void CompileCacheHandler::ReadCacheFile(CompileCacheEntry* entry) {
  Debug("[compile cache] reading cache from %s for %s %s...",
        entry->cache_filename,
        entry->type == CachedCodeType::kCommonJS ? "CommonJS" : "ESM",
        entry->source_filename);

  uv_fs_t req;
  auto defer_req_cleanup = OnScopeLeave([&req]() { uv_fs_req_cleanup(&req); });
  const char* path = entry->cache_filename.c_str();
  uv_file file = uv_fs_open(nullptr, &req, path, O_RDONLY, 0, nullptr);
  if (req.result < 0) {
    // req will be cleaned up by scope leave.
    Debug(" %s\n", uv_strerror(req.result));
    return;
  }
  uv_fs_req_cleanup(&req);

  auto defer_close = OnScopeLeave([file]() {
    uv_fs_t close_req;
    CHECK_EQ(0, uv_fs_close(nullptr, &close_req, file, nullptr));
    uv_fs_req_cleanup(&close_req);
  });

  // Read the headers.
  std::vector<uint32_t> headers(kHeaderCount);
  uv_buf_t headers_buf = uv_buf_init(reinterpret_cast<char*>(headers.data()),
                                     kHeaderCount * sizeof(uint32_t));
  const int r = uv_fs_read(nullptr, &req, file, &headers_buf, 1, 0, nullptr);
  if (r != static_cast<int>(headers_buf.len)) {
    Debug("reading header failed, bytes read %d", r);
    if (req.result < 0 && is_debug_) {
      Debug(", %s", uv_strerror(req.result));
    }
    Debug("\n");
    return;
  }

  Debug("[%d %d %d %d %d]...",
        headers[kMagicNumberOffset],
        headers[kCodeSizeOffset],
        headers[kCacheSizeOffset],
        headers[kCodeHashOffset],
        headers[kCacheHashOffset]);

  if (headers[kMagicNumberOffset] != kCacheMagicNumber) {
    Debug("magic number mismatch: expected %d, actual %d\n",
          kCacheMagicNumber,
          headers[kMagicNumberOffset]);
    return;
  }

  // Check the code size and hash which are already computed.
  if (headers[kCodeSizeOffset] != entry->code_size) {
    Debug("code size mismatch: expected %d, actual %d\n",
          entry->code_size,
          headers[kCodeSizeOffset]);
    return;
  }
  if (headers[kCodeHashOffset] != entry->code_hash) {
    Debug("code hash mismatch: expected %d, actual %d\n",
          entry->code_hash,
          headers[kCodeHashOffset]);
    return;
  }

  // Read the cache, grow the buffer exponentially whenever it fills up.
  size_t offset = headers_buf.len;
  size_t capacity = 4096;  // Initial buffer capacity
  size_t total_read = 0;
  uint8_t* buffer = new uint8_t[capacity];

  while (true) {
    // If there is not enough space to read more data, do a simple
    // realloc here (we don't actually realloc because V8 requires
    // the underlying buffer to be delete[]-able).
    if (total_read == capacity) {
      size_t new_capacity = capacity * 2;
      auto* new_buffer = new uint8_t[new_capacity];
      memcpy(new_buffer, buffer, capacity);
      delete[] buffer;
      buffer = new_buffer;
      capacity = new_capacity;
    }

    uv_buf_t iov = uv_buf_init(reinterpret_cast<char*>(buffer + total_read),
                               capacity - total_read);
    int bytes_read =
        uv_fs_read(nullptr, &req, file, &iov, 1, offset + total_read, nullptr);
    if (req.result < 0) {  // Error.
      // req will be cleaned up by scope leave.
      delete[] buffer;
      Debug(" %s\n", uv_strerror(req.result));
      return;
    }
    uv_fs_req_cleanup(&req);
    if (bytes_read <= 0) {
      break;
    }
    total_read += bytes_read;
  }

  // Check the cache size and hash.
  if (headers[kCacheSizeOffset] != total_read) {
    Debug("cache size mismatch: expected %d, actual %d\n",
          headers[kCacheSizeOffset],
          total_read);
    return;
  }
  uint32_t cache_hash = GetHash(reinterpret_cast<char*>(buffer), total_read);
  if (headers[kCacheHashOffset] != cache_hash) {
    Debug("cache hash mismatch: expected %d, actual %d\n",
          headers[kCacheHashOffset],
          cache_hash);
    return;
  }

  entry->cache.reset(new v8::ScriptCompiler::CachedData(
      buffer, total_read, v8::ScriptCompiler::CachedData::BufferOwned));
  Debug(" success, size=%d\n", total_read);
}

CompileCacheEntry* CompileCacheHandler::GetOrInsert(
    v8::Local<v8::String> code,
    v8::Local<v8::String> filename,
    CachedCodeType type) {
  DCHECK(!compile_cache_dir_.empty());

  Utf8Value filename_utf8(isolate_, filename);
  uint32_t key = GetCacheKey(filename_utf8.ToStringView(), type);

  // TODO(joyeecheung): don't encode this again into UTF8. If we read the
  // UTF8 content on disk as raw buffer (from the JS layer, while watching out
  // for monkey patching), we can just hash it directly.
  Utf8Value code_utf8(isolate_, code);
  uint32_t code_hash = GetHash(code_utf8.out(), code_utf8.length());
  auto loaded = compiler_cache_store_.find(key);

  // TODO(joyeecheung): let V8's in-isolate compilation cache take precedence.
  if (loaded != compiler_cache_store_.end() &&
      loaded->second->code_hash == code_hash) {
    return loaded->second.get();
  }

  auto emplaced =
      compiler_cache_store_.emplace(key, std::make_unique<CompileCacheEntry>());
  auto* result = emplaced.first->second.get();

  std::u8string cache_filename_u8 =
      (compile_cache_dir_ / Uint32ToHex(key)).u8string();
  result->code_hash = code_hash;
  result->code_size = code_utf8.length();
  result->cache_key = key;
  result->cache_filename =
      std::string(cache_filename_u8.begin(), cache_filename_u8.end()) +
      ".cache";
  result->source_filename = filename_utf8.ToString();
  result->cache = nullptr;
  result->type = type;

  // TODO(joyeecheung): if we fail enough times, stop trying for any future
  // files.
  ReadCacheFile(result);

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

// Layout of a cache file:
// [uint32_t] magic number
// [uint32_t] code size
// [uint32_t] code hash
// [uint32_t] cache size
// [uint32_t] cache hash
// .... compile cache content ....
void CompileCacheHandler::Persist() {
  DCHECK(!compile_cache_dir_.empty());

  uv_loop_t loop;
  if (uv_loop_init(&loop)) {
    Debug("[compile cache] Failed to initialize loop for persisting the cache\n");
    return;
  }

  // TODO(joyeecheung): start the writes right after the cache is generated.
  // Either on the main thread or use a new thread, depending on which one has
  // a bigger overhead.
  std::vector<CacheRequest> requests;
  for (auto& pair : compiler_cache_store_) {
    auto* entry = pair.second.get();
    if (entry->cache == nullptr) {
      Debug("[compile cache] skip %s because the cache was not initialized\n",
            entry->source_filename);
      return;
    }
    if (entry->refreshed == false) {
      Debug("[compile cache] skip %s because cache was the same\n",
            entry->source_filename);
      return;
    }
    requests.emplace_back(CacheRequest{is_debug_, entry});
    requests[requests.size() - 1].Start(&loop);
  }

  // Do all the writes using the new event loop, which will be dispatched using the
  // libuv thread pool.
  uv_run(&loop, UV_RUN_DEFAULT);
}

struct CacheRequest {
  CacheRequest(bool debug, const CompileCacheEntry *entry);

  ~CacheRequest() {
    Clean();
  }

  void Clean() {
    uv_fs_req_cleanup(&mkstemp_req);
    uv_fs_req_cleanup(&open_req);
    uv_fs_req_cleanup(&write_req);
    uv_fs_req_cleanup(&close_req);
    uv_fs_req_cleanup(&rename_req);
  }

  template <typename... Args>
  void Debug(const char* format, Args&&... args) const {
    Debug(is_debug, format, std::forward<Args>(args)...);
  }

  void Start(uv_loop_t* loop);
  static void AfterMkstemp(uv_fs_t* req);
  static void AfterOpen(uv_fs_t* req);
  static void AfterWrite(uv_fs_t* req);
  static void AfterClose(uv_fs_t* req);
  static void AfterRename(uv_fs_t* req);

  uv_fs_t mkstemp_req;
  uv_fs_t open_req;
  uv_fs_t write_req;
  uv_fs_t close_req;
  uv_fs_t rename_req;

  uv_file tmpfile_fd;
  bool is_debug;
  std::string tmpfile;
  std::array<uint32_t, CompileCacheHandler::kHeaderCount> headers;
  std::array<uv_buf_t, 2> bufs;
  const CompileCacheEntry *cache_entry;
};

CacheRequest::CacheRequest(bool debug, const CompileCacheEntry *entry)
  : is_debug(debug), tmpfile(entry->cache_filename + "XXXXXX"), cache_entry(entry) {
  DCHECK_EQ(entry->cache->buffer_policy,
            v8::ScriptCompiler::CachedData::BufferOwned);
}

void CacheRequest::Start(uv_loop_t* loop) {
  uv_fs_mkstemp(loop, &mkstemp_req, tmpfile.c_str(), AfterMkstemp);
}

void CacheRequest::AfterMkstemp(uv_fs_t* mkstemp_req) {
  CacheRequest* cache_req = ContainerOf(&CacheRequest::mkstemp_req, mkstemp_req);
  if (mkstemp_req->result) {
    cache_req->Debug("[compile cache] Failed to create %s\n", cache_req->tmpfile);
    cache_req->Clean();
    return;
  }
  uv_fs_open(mkstemp_req->loop, &(cache_req->open_req), mkstemp_req->path, O_WRONLY | O_CREAT | O_TRUNC, S_IWUSR | S_IRUSR, AfterOpen);
}

void CacheRequest::AfterOpen(uv_fs_t* open_req) {
  CacheRequest* cache_req = ContainerOf(&CacheRequest::open_req, open_req);
  if (open_req->result < 0) {
    cache_req->Debug("[compile cache] Failed to open %s: %s\n", cache_req->tmpfile, uv_strerror(open_req->result));
    cache_req->Clean();
    return;
  }

  cache_req->tmpfile_fd = open_req->result;
  const CompileCacheEntry* entry = cache_req->cache_entry;
  char* cache_ptr =
      reinterpret_cast<char*>(const_cast<uint8_t*>(entry->cache->data));
  uint32_t cache_size = static_cast<uint32_t>(entry->cache->length);
  uint32_t cache_hash = GetHash(cache_ptr, cache_size);

  auto& headers = cache_req->headers;
  // Generating headers.
  headers[CompileCacheHandler::kMagicNumberOffset] = kCacheMagicNumber;
  headers[CompileCacheHandler::kCodeSizeOffset] = entry->code_size;
  headers[CompileCacheHandler::kCacheSizeOffset] = cache_size;
  headers[CompileCacheHandler::kCodeHashOffset] = entry->code_hash;
  headers[CompileCacheHandler::kCacheHashOffset] = cache_hash;

  cache_req->Debug("[compile cache] writing cache for %s in %s [%d %d %d %d %d]...\n",
        entry->source_filename,
        cache_req->tmpfile,
        headers[CompileCacheHandler::kMagicNumberOffset],
        headers[CompileCacheHandler::kCodeSizeOffset],
        headers[CompileCacheHandler::kCacheSizeOffset],
        headers[CompileCacheHandler::kCodeHashOffset],
        headers[CompileCacheHandler::kCacheHashOffset]);
  cache_req->bufs[0] = uv_buf_init(reinterpret_cast<char*>(headers.data()),
                                      headers.size() * sizeof(uint32_t));
  cache_req->bufs[1] = uv_buf_init(cache_ptr, entry->cache->length);

  uv_fs_write(open_req->loop, &(cache_req->write_req), cache_req->tmpfile_fd, cache_req->bufs.data(), cache_req->bufs.size(), 0, AfterWrite);
}

void CacheRequest::AfterWrite(uv_fs_t* write_req) {
  CacheRequest* cache_req = ContainerOf(&CacheRequest::write_req, write_req);
  if (write_req->result < 0) {
    cache_req->Debug("[compile cache] Failed to write %s: %s\n", cache_req->tmpfile, uv_strerror(write_req->result));
    cache_req->Clean();
    return;
  }

  cache_req->Debug("[compile cache] Wrote cache for %s in %s\n", cache_req->tmpfile, uv_strerror(write_req->result));
  uv_fs_close(write_req->loop, &(cache_req->close_req), cache_req->tmpfile_fd, AfterClose);
}

void CacheRequest::AfterClose(uv_fs_t* close_req) {
  CacheRequest* cache_req = ContainerOf(&CacheRequest::close_req, close_req);
  if (close_req->result < 0) {
    cache_req->Debug("[compile cache] Failed to close %s: %s\n", cache_req->tmpfile, uv_strerror(close_req->result));
    cache_req->Clean();
    return;
  }
  uv_fs_rename(close_req->loop, &(cache_req->rename_req), cache_req->tmpfile.c_str(), cache_req->cache_entry->cache_filename.c_str(), AfterRename);
}

void CacheRequest::AfterRename(uv_fs_t* rename_req) {
  CacheRequest* cache_req = ContainerOf(&CacheRequest::rename_req, rename_req);
  if (rename_req->result < 0) {
    cache_req->Debug("[compile cache] Failed to rename %s -> %s: %s\n", cache_req->tmpfile, cache_req->cache_entry->cache_filename, uv_strerror(rename_req->result));
  } else {
    cache_req->Debug("[compile cache] Renamed %s -> %s\n", cache_req->tmpfile, cache_req->cache_entry->cache_filename);
  }
  cache_req->Clean();
}

CompileCacheHandler::CompileCacheHandler(Environment* env)
    : isolate_(env->isolate()),
      is_debug_(
          env->enabled_debug_list()->enabled(DebugCategory::COMPILE_CACHE)) {}

// Directory structure:
// - Compile cache directory (from NODE_COMPILE_CACHE)
//   - $NODE_VERION-$ARCH-$CACHE_DATA_VERSION_TAG-$UID
//     - $FILENAME_AND_MODULE_TYPE_HASH.cache: a hash of filename + module type
CompileCacheEnableResult CompileCacheHandler::Enable(Environment* env,
                                                     const std::string& dir) {
  std::string cache_tag = GetCacheVersionTag();
  std::string absolute_cache_dir_base = PathResolve(env, {dir});
  std::filesystem::path cache_dir_with_tag =
      std::filesystem::path(absolute_cache_dir_base) / cache_tag;
  std::u8string cache_dir_with_tag_u8 = cache_dir_with_tag.u8string();
  std::string cache_dir_with_tag_str(cache_dir_with_tag_u8.begin(),
                                     cache_dir_with_tag_u8.end());
  CompileCacheEnableResult result;
  Debug("[compile cache] resolved path %s + %s -> %s\n",
        dir,
        cache_tag,
        cache_dir_with_tag_str);

  if (UNLIKELY(!env->permission()->is_granted(
          env,
          permission::PermissionScope::kFileSystemWrite,
          cache_dir_with_tag_str))) {
    result.message = "Skipping compile cache because write permission for " +
                     cache_dir_with_tag_str + " is not granted";
    result.status = CompileCacheEnableStatus::FAILED;
    return result;
  }

  if (UNLIKELY(!env->permission()->is_granted(
          env,
          permission::PermissionScope::kFileSystemRead,
          cache_dir_with_tag_str))) {
    result.message = "Skipping compile cache because read permission for " +
                     cache_dir_with_tag_str + " is not granted";
    result.status = CompileCacheEnableStatus::FAILED;
    return result;
  }

  fs::FSReqWrapSync req_wrap;
  int err = fs::MKDirpSync(
      nullptr, &(req_wrap.req), cache_dir_with_tag_str, 0777, nullptr);
  if (is_debug_) {
    Debug("[compile cache] creating cache directory %s...%s\n",
          cache_dir_with_tag_str,
          err < 0 ? uv_strerror(err) : "success");
  }
  if (err != 0 && err != UV_EEXIST) {
    result.message =
        "Cannot create cache directory: " + std::string(uv_strerror(err));
    result.status = CompileCacheEnableStatus::FAILED;
    return result;
  }

  compile_cache_dir_str_ = absolute_cache_dir_base;
  result.cache_directory = absolute_cache_dir_base;
  compile_cache_dir_ = cache_dir_with_tag;
  result.status = CompileCacheEnableStatus::ENABLED;
  return result;
}

}  // namespace node
