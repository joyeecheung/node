#include "node_native_module.h"
#include "node_code_cache.h"
#include "node_errors.h"
#include "node_javascript.h"

namespace node {
namespace native_module {

using v8::Array;
using v8::ArrayBuffer;
using v8::Context;
using v8::EscapableHandleScope;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Integer;
using v8::IntegrityLevel;
using v8::Isolate;
using v8::Local;
using v8::Maybe;
using v8::MaybeLocal;
using v8::Object;
using v8::Script;
using v8::ScriptCompiler;
using v8::ScriptOrigin;
using v8::Set;
using v8::String;
using v8::TryCatch;
using v8::Uint8Array;
using v8::Value;

// For legacy process.binding('natives') which is mutable
void NativeModule::GetNatives(Environment* env, Local<Object> exports) {
  DefineJavaScript(env, exports);
}

void NativeModule::LoadBindings(Environment* env) {
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();
  Local<Object> native_module_source = Object::New(isolate);
  DefineJavaScript(env, native_module_source);
  native_module_source->SetIntegrityLevel(context, IntegrityLevel::kFrozen)
      .FromJust();
  env->set_native_module_source(native_module_source);

  Local<Object> native_module_source_hash = Object::New(isolate);
  DefineJavaScriptHash(env, native_module_source_hash);
  native_module_source_hash->SetIntegrityLevel(context, IntegrityLevel::kFrozen)
      .FromJust();
  env->set_native_module_source_hash(native_module_source_hash);

  Local<Object> native_module_code_cache = Object::New(isolate);
  DefineCodeCache(env, native_module_code_cache);
  native_module_code_cache->SetIntegrityLevel(context, IntegrityLevel::kFrozen)
      .FromJust();
  env->set_native_module_code_cache(native_module_code_cache);

  Local<Object> native_module_code_cache_hash = Object::New(isolate);
  DefineCodeCacheHash(env, native_module_code_cache_hash);
  native_module_code_cache_hash
      ->SetIntegrityLevel(context, IntegrityLevel::kFrozen)
      .FromJust();
  env->set_native_module_code_cache_hash(native_module_code_cache_hash);

  env->set_native_module_column_offset(Integer::New(isolate, 0));
  env->set_native_module_line_offset(Integer::New(isolate, 0));

  env->set_native_module_with_cache(Set::New(isolate));
  env->set_native_module_without_cache(Set::New(isolate));
}

void NativeModule::CompileCodeCache(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  CHECK(args[0]->IsString());
  Local<String> id = args[0].As<String>();

  // TODO(joyeecheung): accept parameters array optionally

  Local<Value> result = CompileAsModule(env, id, true);
  if (!result.IsEmpty()) {
    args.GetReturnValue().Set(result);
  }
}

void NativeModule::CompileFunction(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  CHECK(args[0]->IsString());
  Local<String> id = args[0].As<String>();

  // TODO(joyeecheung): accept parameters array optionally

  Local<Value> result = CompileAsModule(env, id, false);
  if (!result.IsEmpty()) {
    args.GetReturnValue().Set(result);
  }
}

Local<Value> NativeModule::CompileAsModule(Environment* env,
                                           Local<String> id,
                                           bool produce_code_cache) {
  Local<String> parameters[] = {env->exports_string(),
                                env->require_string(),
                                env->module_string(),
                                env->process_string(),
                                env->internal_binding_string()};

  return Compile(
      env, id, parameters, arraysize(parameters), produce_code_cache);
}

// Currently V8 only checks that the length of the source code is the
// same as the code used to generate the hash, so we add an additional
// check here:
// 1. During compile time, when generating node_javascript.cc and
//    node_code_cache.cc, we compute and include the hash of the
//   (unwrapped) JavaScript source in both.
// 2. At runtime, we check that the hash of the code being compiled
//   and the hash of the code used to generate the cache
//   (inside the wrapper) is the same.
// This is based on the assumptions:
// 1. `code_cache_hash` must be in sync with
//    `code_cache` (both defined in node_code_cache.cc)
// 2. `source_hash` must be in sync with
//    `source` (both defined in node_javascript.cc)
// 3. If `source_hash` is in sync with `code_cache_hash`,
//    then the (unwrapped) code used to generate `code_cache`
//    should be in sync with the (unwrapped) code in
//    `source`
// There will be, however, false positives if the wrapper used
// to generate the cache is different from the one used at run time,
// and the length of the wrapper somehow stays the same.
// But that should be rare and can be eased once we make the
// two bootstrappers cached and checked as well.
ScriptCompiler::CachedData* GetCachedData(Environment* env, Local<String> id) {
  HandleScope scope(env->isolate());
  Local<Context> context = env->context();

  Local<Value> result =
      env->native_module_code_cache()->Get(context, id).ToLocalChecked();
  // This could be false if the module cannot be cached somehow
  if (result->IsUndefined()) {
    return nullptr;
  }

  CHECK(result->IsUint8Array());
  Local<Uint8Array> code_cache = result.As<Uint8Array>();

  result =
      env->native_module_code_cache_hash()->Get(context, id).ToLocalChecked();
  CHECK(result->IsString());
  Local<String> code_cache_hash = result.As<String>();

  result = env->native_module_source_hash()->Get(context, id).ToLocalChecked();
  CHECK(result->IsString());
  Local<String> source_hash = result.As<String>();

  // It may fail when any of the inputs of the `node_js2c` target in
  // node.gyp is modified but the tools/generate_code_cache.js
  // is not re run.
  // FIXME(joyeecheung): Figure out how to resolve the dependency issue.
  // When the code cache was introduced we were at a point where refactoring
  // node.gyp may not be worth the effort.
  CHECK(code_cache_hash->StrictEquals(source_hash));

  ArrayBuffer::Contents contents = code_cache->Buffer()->GetContents();
  uint8_t* data = static_cast<uint8_t*>(contents.Data());
  return new ScriptCompiler::CachedData(data + code_cache->ByteOffset(),
                                        code_cache->ByteLength());
}

// Returns Local<Function> of the compiled module if produce_code_cache
// is false (we are only compiling the function).
// Otherwise return Local<Object> containing the cache.
Local<Value> NativeModule::Compile(Environment* env,
                                   Local<String> id,
                                   Local<String>* parameters,
                                   size_t parameters_count,
                                   bool produce_code_cache) {
  EscapableHandleScope scope(env->isolate());
  Local<Context> context = env->context();
  Isolate* isolate = env->isolate();

  Local<String> source;
  Local<Uint8Array> code_cache;

  Local<Value> result;
  result = env->native_module_source()->Get(context, id).ToLocalChecked();
  CHECK(result->IsString());
  source = result.As<String>();

  Local<String> filename =
      String::Concat(isolate, id, FIXED_ONE_BYTE_STRING(isolate, ".js"));
  Local<Integer> line_offset = env->native_module_line_offset();
  Local<Integer> column_offset = env->native_module_column_offset();
  ScriptOrigin origin(filename, line_offset, column_offset);

  bool use_cache = false;
  ScriptCompiler::CachedData* cached_data = nullptr;

  // 1. We won't even check the existence of the cache if the binary is not
  //    built with them.
  // 2. If we are generating code cache for tools/general_code_cache.js, we are
  //    not going to use any cache.
  if (native_module_has_code_cache && !produce_code_cache) {
    cached_data = GetCachedData(env, id);
    if (cached_data != nullptr) {
      use_cache = true;
    }
  }

  ScriptCompiler::Source script_source(source, origin, cached_data);

  ScriptCompiler::CompileOptions options;
  if (produce_code_cache) {
    options = ScriptCompiler::kEagerCompile;
  } else if (use_cache) {
    options = ScriptCompiler::kConsumeCodeCache;
  } else {
    options = ScriptCompiler::kNoCompileOptions;
  }

  MaybeLocal<Function> maybe_fun =
      ScriptCompiler::CompileFunctionInContext(context,
                                               &script_source,
                                               parameters_count,
                                               parameters,
                                               0,
                                               nullptr,
                                               options);

  TryCatch try_catch(isolate);
  Local<Function> fun;

  // This could fail when there is syntax error in the native modules
  if (maybe_fun.IsEmpty() || !maybe_fun.ToLocal(&fun)) {
    DecorateErrorStack(env, try_catch);
    try_catch.ReThrow();
    return scope.Escape(Local<Value>());
  }

  if (use_cache) {
    CHECK(!script_source.GetCachedData()->rejected);
    if (env->native_module_with_cache()->Add(context, id).IsEmpty()) {
      return scope.Escape(Local<Value>());
    }
  } else {
    if (env->native_module_without_cache()->Add(context, id).IsEmpty()) {
      return scope.Escape(Local<Value>());
    }
  }

  if (produce_code_cache) {
    const ScriptCompiler::CachedData* cached_data =
      ScriptCompiler::CreateCodeCacheForFunction(fun);
    CHECK_NE(cached_data, nullptr);
    Local<Object> buf =
        Buffer::Copy(env,
                     reinterpret_cast<const char*>(cached_data->data),
                     cached_data->length)
            .ToLocalChecked();
    return scope.Escape(buf);
  } else {
    return scope.Escape(fun);
  }
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context) {
  Environment* env = Environment::GetCurrent(context);

  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(env->isolate(), "source"),
            env->native_module_source())
      .FromJust();
  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(env->isolate(), "sourceHash"),
            env->native_module_source_hash())
      .FromJust();
  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(env->isolate(), "codeCache"),
            env->native_module_code_cache())
      .FromJust();
  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(env->isolate(), "codeCacheHash"),
            env->native_module_code_cache_hash())
      .FromJust();
  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(env->isolate(), "compiledWithCache"),
            env->native_module_with_cache())
      .FromJust();
  target
      ->Set(context,
            FIXED_ONE_BYTE_STRING(env->isolate(), "compiledWithoutCache"),
            env->native_module_without_cache())
      .FromJust();

  env->SetMethod(target, "compileFunction", NativeModule::CompileFunction);
  env->SetMethod(target, "compileCodeCache", NativeModule::CompileCodeCache);
  // getInternalBinding('native_module') should be forzen
  target->SetIntegrityLevel(context, IntegrityLevel::kFrozen).FromJust();
}

}  // namespace native_module
}  // namespace node

NODE_MODULE_CONTEXT_AWARE_INTERNAL(native_module,
                                   node::native_module::Initialize)
