#ifndef SRC_COMPILE_CACHE_H_
#define SRC_COMPILE_CACHE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cinttypes>
#include <memory>
#include <string>
#include <unordered_map>
#include "v8.h"

namespace node {
class Environment;

// TODO(joyeecheung): move it into a CacheHandler class.
enum class CachedCodeType : uint8_t {
  kCommonJS = 0,
  kESM,
};

struct CompileCacheEntry {
  std::unique_ptr<v8::ScriptCompiler::CachedData> cache{nullptr};
  uint32_t cache_hash;
  std::string cache_filename;
  std::string source_filename;
  CachedCodeType type;
  bool refreshed = false;
  // Copy the cache into a new store for V8 to consume. Caller takes
  // ownership.
  v8::ScriptCompiler::CachedData* CopyCache() const;
};

class CompileCacheHandler {
 public:
  CompileCacheHandler(Environment* env);
  bool InitializeDirectory(const std::string& dir);

  void Persist();
  CompileCacheEntry* Get(v8::Local<v8::String> code,
                         v8::Local<v8::String> filename,
                         CachedCodeType type);
  void MaybeSave(CompileCacheEntry* entry,
                 v8::Local<v8::Function> func,
                 bool rejected);
  void MaybeSave(CompileCacheEntry* entry,
                 v8::Local<v8::Module> mod,
                 bool rejected);

 private:
  template <typename T>
  void MaybeSaveImpl(CompileCacheEntry* entry,
                     v8::Local<T> func_or_mod,
                     bool rejected);

  uint32_t HashFileFor(std::string_view code,
                       std::string_view filename,
                       CachedCodeType type);

  template <typename... Args>
  inline void Debug(const char* format, Args&&... args) const;

  v8::Isolate* isolate_ = nullptr;
  bool is_debug_ = false;

  std::string compile_cache_dir_;
  uint32_t compiler_cache_hash_ = 0;
  std::unordered_map<uint32_t, std::unique_ptr<CompileCacheEntry>>
      compiler_cache_store_;
};
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_COMPILE_CACHE_H_
