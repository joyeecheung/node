
#include <vector>
#include "env.h"
#include "path.h"

using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;
using v8::ObjectTemplate;
using v8::String;
using v8::LocalVector;
using v8::ScriptOrigin;
using v8::ScriptCompiler;
using v8::MaybeLocal;
using v8::Maybe;

namespace node {

constexpr const char* kAnonymousMainPath = "__node_anonymous_main";

std::string GetAnonymousMainPath() {
  return kAnonymousMainPath;
}

namespace embedding {

void RunEmbedderPreload(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  CHECK(env->embedder_preload());
  CHECK_EQ(args.Length(), 2);
  Local<Value> process_obj = args[0];
  Local<Value> require_fn = args[1];
  CHECK(process_obj->IsObject());
  CHECK(require_fn->IsFunction());
  env->embedder_preload()(env, process_obj, require_fn);
}

Maybe<void> RunSnapshotMain(Environment* env, Local<Context> context) {
  const SnapshotConfig* config = env->isolate_data()->snapshot_config();
  CHECK_NOT_NULL(config);
  CHECK(config->builder_script_path.has_value());

  std::string build_script_content;
  const char* path = config->builder_script_path.value().data();
  int r = ReadFileSync(&build_script_content, path);
  if (r != 0) {
    std::string message = "Cannot read builder script for snapshot: " + config->builder_script_path.value() + uv_strerror(r);
    env->ThrowError(message.c_str());
    return v8::Nothing<void>();
  }
  Local<String> source;
  if(!ToV8Value(context,
                env->isolate_data()
                    ->snapshot_config()
                    ->builder_script_path.value()).ToLocal(&source)) {
    return v8::Nothing<void>();
  }

}

void RunEmbedderEntryPointAsCJS(Environment* env, Local<String> source) {
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();
  HandleScope handle_scope(isolate);
  // TODO(joyeecheung): do we need all of these? Maybe we would want a less
  // internal version of them.
  LocalVector<String> parameters(
      isolate,
      { env->require_string(), env->__filename_string(), env->__dirname_string(), });

  Local<String> filename, dirname;
  const std::string& argv1 = env->argv().size() >= 2 ? env->argv()[1] : "";
  if (env->argv().size() >= 2 && argv1 == kAnonymousMainPath) {
    filename = ToV8Value(context, argv1).ToLocalChecked().As<String>();
    dirname = filename;
  } else {
    std::vector<std::string_view> paths = { argv1 };
    std::string filename_str = PathResolve(env, paths);
    filename = ToV8Value(context, filename_str).ToLocalChecked().As<String>();
    paths = { filename_str, "../" };
    dirname = ToV8Value(context, PathResolve(env, paths)).ToLocalChecked().As<String>();
  }

  ScriptOrigin script_origin(filename, 0, 0, true);
  ScriptCompiler::Source script_source(source, script_origin);
  MaybeLocal<Function> maybe_fn =
      ScriptCompiler::CompileFunction(context,
                                      &script_source,
                                      parameters.size(),
                                      parameters.data(),
                                      0,
                                      nullptr);
  Local<Function> fn;
  if (!maybe_fn.ToLocal(&fn)) {
    return;
  }

  #if HAVE_INSPECTOR
    if (env->options()->debug_options().break_first_line) {
      env->inspector_agent()->PauseOnNextJavascriptStatement("Break on start");
    }
  #endif

    env->performance_state()->Mark(
        performance::NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE);
}

void RunEmbedderEntryPointAsCJS(const FunctionCallbackInfo<Value>& args) {
  CHECK(args[0]->IsString());
  Local<String> filename = args[0].As<String>();
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Environment* env = Environment::GetCurrent(context);
  Local<String> source = args[0].As<String>();

  RunEmbedderEntryPointAsCJS(env, source);
}

Local<Function> GetRunCJSFunction(Environment* env, Local<String> source) {
  
}

void CreatePerContextProperties(Local<Object> target,
                                Local<Value> unused,
                                Local<Context> context,
                                void* priv) {
  Environment* env = Environment::GetCurrent(context);
  Isolate* isolate = env->isolate();
  target->Get(context, FIXED_ONE_BYTE_STRING(isolate, "runEmbeddedEntrypointAsCJS")).ToLocalChecked();
}

void CreatePerIsolateProperties(IsolateData* isolate_data,
                                Local<ObjectTemplate> target) {
  Isolate* isolate = isolate_data->isolate();
  SetMethod(isolate, target, "runEmbedderPreload", RunEmbedderPreload);
  SetMethod(isolate, target, "runEmbeddedEntrypointAsCJS", RunEmbedderEntryPointAsCJS);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(RunEmbedderPreload);
  registry->Register(RunEmbedderEntryPointAsCJS);
}
}  // namespace embedding
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    embedding, node::embedding::CreatePerContextProperties)
NODE_BINDING_PER_ISOLATE_INIT(embedding,
                              node::embedding::CreatePerIsolateProperties)
NODE_BINDING_EXTERNAL_REFERENCE(embedding,
                                node::embedding::RegisterExternalReferences)
