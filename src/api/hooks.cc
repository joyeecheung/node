#include "env-inl.h"
#include "node.h"
#include "node_process.h"

namespace node {

using v8::Context;
using v8::HandleScope;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

void RunAtExit(Environment* env) {
  env->RunAtExitCallbacks();
}

void AtExit(void (*cb)(void* arg), void* arg) {
  auto env = Environment::GetThreadLocalEnv();
  AtExit(env, cb, arg);
}

void AtExit(Environment* env, void (*cb)(void* arg), void* arg) {
  CHECK_NOT_NULL(env);
  env->AtExit(cb, arg);
}

void EmitBeforeExit(Environment* env) {
  HandleScope handle_scope(env->isolate());
  Context::Scope context_scope(env->context());
  Local<Value> exit_code = env->process_object()
                               ->Get(env->context(), env->exit_code_string())
                               .ToLocalChecked()
                               ->ToInteger(env->context())
                               .ToLocalChecked();
  ProcessEmit(env, "beforeExit", exit_code).ToLocalChecked();
}

int EmitExit(Environment* env) {
  // process.emit('exit')
  HandleScope handle_scope(env->isolate());
  Context::Scope context_scope(env->context());
  Local<Object> process_object = env->process_object();
  process_object
      ->Set(env->context(),
            FIXED_ONE_BYTE_STRING(env->isolate(), "_exiting"),
            True(env->isolate()))
      .FromJust();

  Local<String> exit_code = env->exit_code_string();
  int code = process_object->Get(env->context(), exit_code)
                 .ToLocalChecked()
                 ->Int32Value(env->context())
                 .ToChecked();
  ProcessEmit(env, "exit", Integer::New(env->isolate(), code));

  // Reload exit code, it may be changed by `emit('exit')`
  return process_object->Get(env->context(), exit_code)
      .ToLocalChecked()
      ->Int32Value(env->context())
      .ToChecked();
}

void AddPromiseHook(Isolate* isolate, promise_hook_func fn, void* arg) {
  Environment* env = Environment::GetCurrent(isolate);
  CHECK_NOT_NULL(env);
  env->AddPromiseHook(fn, arg);
}

void AddEnvironmentCleanupHook(Isolate* isolate,
                               void (*fun)(void* arg),
                               void* arg) {
  Environment* env = Environment::GetCurrent(isolate);
  CHECK_NOT_NULL(env);
  env->AddCleanupHook(fun, arg);
}

void RemoveEnvironmentCleanupHook(Isolate* isolate,
                                  void (*fun)(void* arg),
                                  void* arg) {
  Environment* env = Environment::GetCurrent(isolate);
  CHECK_NOT_NULL(env);
  env->RemoveCleanupHook(fun, arg);
}

}  // namespace node
