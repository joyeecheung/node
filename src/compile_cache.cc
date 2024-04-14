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

std::string CRC32Hex(const char* data, size_t size) {
  uLong crc = crc32(0L, Z_NULL, 0);
  crc = crc32(crc, reinterpret_cast<const Bytef*>(data), size);
  return Uint32ToHex(static_cast<uint32_t>(crc));
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

template <typename... Args>
inline void CompileCacheHandler::Debug(const char* format,
                                       Args&&... args) const {
  if (UNLIKELY(is_debug_)) {
    FPrintF(stderr, format, std::forward<Args>(args)...);
  }
}

uint32_t CompileCacheHandler::HashFileFor(std::string_view code,
                                          std::string_view filename,
                                          CachedCodeType type) {
  uLong crc = crc32(0L, Z_NULL, 0);
  crc = crc32(crc, reinterpret_cast<const Bytef*>(code.data()), code.length());
  crc = crc32(
      crc, reinterpret_cast<const Bytef*>(filename.data()), filename.length());

  return crc;
}

v8::ScriptCompiler::CachedData* CompileCacheEntry::CopyCache() const {
  CHECK_NOT_NULL(cache);
  int cache_size = cache->length;
  uint8_t* data = new uint8_t[cache_size];
  memcpy(data, cache->data, cache_size);
  return new v8::ScriptCompiler::CachedData(
      data, cache_size, v8::ScriptCompiler::CachedData::BufferOwned);
}

CompileCacheEntry* CompileCacheHandler::Get(v8::Local<v8::String> code,
                                            v8::Local<v8::String> filename,
                                            CachedCodeType type) {
  DCHECK(!compile_cache_dir_.empty());

  Utf8Value filename_utf8(isolate_, filename);
  Utf8Value code_utf8(isolate_, code);
  uint32_t hash =
      HashFileFor(code_utf8.ToStringView(), filename_utf8.ToStringView(), type);

  auto loaded = compiler_cache_store_.find(hash);
  if (loaded != compiler_cache_store_.end()) {
    return loaded->second.get();
  }

  auto emplaced = compiler_cache_store_.emplace(
      hash, std::make_unique<CompileCacheEntry>());
  auto* result = emplaced.first->second.get();
  result->cache_hash = hash;
  result->cache_filename =
      compile_cache_dir_ + kPathSeparator + Uint32ToHex(result->cache_hash);
  result->source_filename = filename_utf8.ToString();
  result->cache = nullptr;
  result->type = type;

  Debug("[compile cache] Reading cache from %s for %s %s...",
        result->cache_filename,
        type == CachedCodeType::kCommonJS ? "CommonJS" : "ESM",
        result->source_filename);
  // TODO(joyeecheung): if we fail enough times, stop trying for any future
  // files.
  std::string code_cache_store;
  int err = ReadFileSync(&code_cache_store, result->cache_filename.c_str());
  if (err < 0) {
    Debug(" failed: %d\n", err);
    return result;
  }

  size_t cache_size = code_cache_store.size();
  // TODO(joyeecheung): add a helper that just read into new uint8_t[]
  // to avoid the copy.
  uint8_t* data = new uint8_t[cache_size];
  memcpy(data, code_cache_store.data(), cache_size);
  result->cache.reset(new v8::ScriptCompiler::CachedData(
      data, cache_size, v8::ScriptCompiler::CachedData::BufferOwned));
  Debug(" success, size=%d\n", cache_size);

  return result;
}

void CompileCacheHandler::MaybeSave(CompileCacheEntry* entry,
                                    v8::Local<v8::Function> func,
                                    bool rejected) {
  DCHECK_NOT_NULL(entry);
  Debug("[compile cache] checking for %s which was %s\n",
        entry->source_filename,
        rejected ? "rejected" : "not rejected");
  if (entry->cache != nullptr && !rejected) {
    return;
  }
  MaybeSave(
      entry, v8::ScriptCompiler::CreateCodeCacheForFunction(func), rejected);
}

void CompileCacheHandler::MaybeSave(CompileCacheEntry* entry,
                                    v8::Local<v8::Module> mod,
                                    bool rejected) {
  DCHECK_NOT_NULL(entry);
  DCHECK(mod->IsSourceTextModule());
  if (entry->cache != nullptr && !rejected) {
    return;
  }
  Debug("[compile cache] checking for %s which was %s\n",
        entry->source_filename,
        rejected ? "rejected" : "not rejected");
  MaybeSave(entry,
            v8::ScriptCompiler::CreateCodeCache(mod->GetUnboundModuleScript()),
            rejected);
}

void CompileCacheHandler::MaybeSave(CompileCacheEntry* entry,
                                    v8::ScriptCompiler::CachedData* data,
                                    bool rejected) {
  Debug("[compile cache] saving cache for %s because it's %s\n",
        entry->source_filename,
        rejected ? "rejected" : "not cached before");
  CHECK_EQ(data->buffer_policy, v8::ScriptCompiler::CachedData::BufferOwned);
  entry->refreshed = true;
  entry->cache.reset(data);
}

void CompileCacheHandler::Persist() {
  DCHECK(!compile_cache_dir_.empty());
  for (auto& pair : compiler_cache_store_) {
    auto* entry = pair.second.get();
    if (entry->cache == nullptr) {
      Debug("[compile cache] skip %s because there was no cache\n",
            entry->source_filename);
      continue;
    }
    if (entry->refreshed == false) {
      Debug("[compile cache] skip %s because cache was the same\n",
            entry->source_filename);
      continue;
    }
    Debug("[compile cache] writing cache for %s in %s...",
          entry->source_filename,
          entry->cache_filename);
    CHECK_EQ(entry->cache->buffer_policy,
             v8::ScriptCompiler::CachedData::BufferOwned);
    // TODO(joyeecheung): prepend checksum.
    uv_buf_t buf = uv_buf_init(
        reinterpret_cast<char*>(const_cast<uint8_t*>(entry->cache->data)),
        entry->cache->length);
    int err = WriteFileSync(entry->cache_filename.c_str(), buf);
    Debug("%d\n", err);
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
//     - <cache_file_1>: a hash of code content + filename
//     - <cache_file_2>
//     - <cache_file_3>
bool CompileCacheHandler::InitializeDirectory(const std::string& dir) {
  compiler_cache_hash_ = GetCacheVersionTag();
  std::string cache_dir =
      dir + kPathSeparator + Uint32ToHex(compiler_cache_hash_);

  fs::FSReqWrapSync req_wrap;
  int err = fs::MKDirpSync(nullptr, &(req_wrap.req), cache_dir, 0777, nullptr);
  Debug("[compile cache] creating cache directory %s...%d\n", cache_dir, err);
  if (err != 0 && err != UV_EEXIST) {
    return false;
  }

  uv_fs_t req;
  auto clean = OnScopeLeave([&req]() { uv_fs_req_cleanup(&req); });
  // TODO(joyeecheung): use something cheaper.
  err = uv_fs_realpath(nullptr, &req, cache_dir.data(), nullptr);
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
