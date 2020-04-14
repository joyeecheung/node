#include <memory>

#include "node_main_instance.h"
#include <iostream>
#include "node_errors.h"
#include "node_native_module_env.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "node_options-inl.h"
#include "node_process.h"
#include "node_v8_platform-inl.h"
#include "util-inl.h"
#if defined(LEAK_SANITIZER)
#include <sanitizer/lsan_interface.h>
#endif

#if HAVE_INSPECTOR
#include "inspector/worker_inspector.h"  // ParentInspectorHandle
#endif

namespace node {

using v8::Context;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Locker;
using v8::Object;
using v8::SealHandleScope;

std::unique_ptr<ExternalReferenceRegistry> NodeMainInstance::registry_ =
    nullptr;
NodeMainInstance::NodeMainInstance(Isolate* isolate,
                                   uv_loop_t* event_loop,
                                   MultiIsolatePlatform* platform,
                                   const std::vector<std::string>& args,
                                   const std::vector<std::string>& exec_args)
    : args_(args),
      exec_args_(exec_args),
      array_buffer_allocator_(nullptr),
      isolate_(isolate),
      platform_(platform),
      isolate_data_(nullptr),
      owns_isolate_(false),
      deserialize_mode_(false) {
  isolate_data_ =
      std::make_unique<IsolateData>(isolate_, event_loop, platform, nullptr);

  IsolateSettings misc;
  SetIsolateMiscHandlers(isolate_, misc);
}

const std::vector<intptr_t>& NodeMainInstance::CollectExternalReferences(Environment* env) {
  // Cannot be called more than once.
  CHECK_NULL(registry_);
  registry_.reset(new ExternalReferenceRegistry());

  registry_->Register(env);
  registry_->Register(node::RawDebug);
  registry_->Register(node::binding::GetLinkedBinding);
  registry_->Register(node::binding::GetInternalBinding);
  node::native_module::NativeModuleEnv::CollectExternalReferences(registry_.get());
  // TODO(joyeecheung): collect more external references here.
  return registry_->external_references();
}

std::unique_ptr<NodeMainInstance> NodeMainInstance::Create(
    Isolate* isolate,
    uv_loop_t* event_loop,
    MultiIsolatePlatform* platform,
    const std::vector<std::string>& args,
    const std::vector<std::string>& exec_args) {
  return std::unique_ptr<NodeMainInstance>(
      new NodeMainInstance(isolate, event_loop, platform, args, exec_args));
}

NodeMainInstance::NodeMainInstance(
    Isolate::CreateParams* params,
    uv_loop_t* event_loop,
    MultiIsolatePlatform* platform,
    const std::vector<std::string>& args,
    const std::vector<std::string>& exec_args,
    const std::vector<size_t>* per_isolate_data_indexes)
    : args_(args),
      exec_args_(exec_args),
      array_buffer_allocator_(ArrayBufferAllocator::Create()),
      isolate_(nullptr),
      platform_(platform),
      isolate_data_(nullptr),
      owns_isolate_(true) {
  params->array_buffer_allocator = array_buffer_allocator_.get();

  // Allocate the memory first so that we have an Environment address to
  // deserialize in Embedder fields.
  env_.reset(
      reinterpret_cast<Environment*>(new uint8_t[sizeof(Environment)]));

  deserialize_mode_ = per_isolate_data_indexes != nullptr;
  if (deserialize_mode_) {
    // TODO(joyeecheung): collect external references and set it in
    // params.external_references.
    const std::vector<intptr_t>& external_references = CollectExternalReferences(env_.get());
    params->external_references = external_references.data();
  }

  isolate_ = Isolate::Allocate();
  CHECK_NOT_NULL(isolate_);
  // Register the isolate on the platform before the isolate gets initialized,
  // so that the isolate can access the platform during initialization.
  platform->RegisterIsolate(isolate_, event_loop);
  SetIsolateCreateParamsForNode(params);
  Isolate::Initialize(isolate_, *params);

  // If the indexes are not nullptr, we are not deserializing
  CHECK_IMPLIES(deserialize_mode_, params->external_references != nullptr);
  isolate_data_ = std::make_unique<IsolateData>(isolate_,
                                                event_loop,
                                                platform,
                                                array_buffer_allocator_.get(),
                                                per_isolate_data_indexes);
  IsolateSettings s;
  SetIsolateMiscHandlers(isolate_, s);
  if (!deserialize_mode_) {
    // If in deserialize mode, delay until after the deserialization is
    // complete.
    SetIsolateErrorHandlers(isolate_, s);
  }
}

void NodeMainInstance::Dispose() {
  CHECK(!owns_isolate_);
  platform_->DrainTasks(isolate_);
}

NodeMainInstance::~NodeMainInstance() {
  if (!owns_isolate_) {
    return;
  }
  // TODO(addaleax): Reverse the order of these calls. The fact that we first
  // dispose the Isolate is a temporary workaround for
  // https://github.com/nodejs/node/issues/31752 -- V8 should not be posting
  // platform tasks during Dispose(), but it does in some WASM edge cases.
  isolate_->Dispose();
  platform_->UnregisterIsolate(isolate_);
}

int NodeMainInstance::Run(const EnvSerializeInfo* env_info) {
  Locker locker(isolate_);
  Isolate::Scope isolate_scope(isolate_);
  HandleScope handle_scope(isolate_);

  int exit_code = 0;
  CreateMainEnvironment(&exit_code, env_info);

  CHECK_NOT_NULL(env_);
  {
  Context::Scope context_scope(env_->context());

  if (exit_code == 0) {
    LoadEnvironment(env_.get());

    env_->set_trace_sync_io(env_->options()->trace_sync_io);

    {
      SealHandleScope seal(isolate_);
      bool more;
      env_->performance_state()->Mark(
          node::performance::NODE_PERFORMANCE_MILESTONE_LOOP_START);
      do {
        uv_run(env_->event_loop(), UV_RUN_DEFAULT);

        per_process::v8_platform.DrainVMTasks(isolate_);

        more = uv_loop_alive(env_->event_loop());
        if (more && !env_->is_stopping()) continue;

        if (!uv_loop_alive(env_->event_loop())) {
          EmitBeforeExit(env_.get());
        }

        // Emit `beforeExit` if the loop became alive either after emitting
        // event, or after running some callbacks.
        more = uv_loop_alive(env_->event_loop());
      } while (more == true && !env_->is_stopping());
      env_->performance_state()->Mark(
          node::performance::NODE_PERFORMANCE_MILESTONE_LOOP_EXIT);
    }

    env_->set_trace_sync_io(false);
    exit_code = EmitExit(env_.get());
  }

  env_->set_can_call_into_js(false);
  env_->stop_sub_worker_contexts();
  ResetStdio();
  env_->RunCleanup();

  // TODO(addaleax): Neither NODE_SHARED_MODE nor HAVE_INSPECTOR really
  // make sense here.
#if HAVE_INSPECTOR && defined(__POSIX__) && !defined(NODE_SHARED_MODE)
  struct sigaction act;
  memset(&act, 0, sizeof(act));
  for (unsigned nr = 1; nr < kMaxSignal; nr += 1) {
    if (nr == SIGKILL || nr == SIGSTOP || nr == SIGPROF)
      continue;
    act.sa_handler = (nr == SIGPIPE) ? SIG_IGN : SIG_DFL;
    CHECK_EQ(0, sigaction(nr, &act, nullptr));
  }
#endif

  RunAtExit(env_.get());

  per_process::v8_platform.DrainVMTasks(isolate_);

#if defined(LEAK_SANITIZER)
  __lsan_do_leak_check();
#endif
  }

  env_.reset(nullptr);
  return exit_code;
}

void DeserializeNodeInternalFields(Local<Object> holder,
                                   int index,
                                   v8::StartupData payload,
                                   void* env) {
  if (payload.raw_size == 0) {
    holder->SetAlignedPointerInInternalField(index, nullptr);
    return;
  }
  const InternalFieldInfo* info =
      reinterpret_cast<const InternalFieldInfo*>(payload.data);
  switch (info->type) {
    case InternalFieldType::kDefault: {
      break;
    }
    default: {
      break;
    }
  }
}

// TODO(joyeecheung): align this with the CreateEnvironment exposed in node.h
// and the environment creation routine in workers somehow.
void NodeMainInstance::CreateMainEnvironment(
    int* exit_code, const EnvSerializeInfo* env_info) {
  *exit_code = 0;  // Reset the exit code to 0

  HandleScope handle_scope(isolate_);

  // TODO(addaleax): This should load a real per-Isolate option, currently
  // this is still effectively per-process.
  if (isolate_data_->options()->track_heap_objects) {
    isolate_->GetHeapProfiler()->StartTrackingHeapObjects(true);
  }

  Local<Context> context;
  if (deserialize_mode_) {
    context = Context::FromSnapshot(isolate_,
                                    kNodeContextIndex,
                                    {DeserializeNodeInternalFields, env_.get()})
                  .ToLocalChecked();
    InitializeContextRuntime(context);
    IsolateSettings s;
    SetIsolateErrorHandlers(isolate_, s);
  } else {
    context = NewContext(isolate_);
  }

  CHECK(!context.IsEmpty());
  Context::Scope context_scope(context);

  // Do the actual instantiation.
  new (env_.get()) Environment(
      isolate_data_.get(),
      context,
      args_,
      exec_args_,
      env_info,
      static_cast<Environment::Flags>(Environment::kIsMainThread |
                                      Environment::kOwnsProcessState |
                                      Environment::kOwnsInspector));

  if (!deserialize_mode_ && env_->RunBootstrapping().IsEmpty()) {
    *exit_code = 1;
    return;
  }

  if (deserialize_mode_ && env_->BootstrapNode().IsEmpty()) {
    *exit_code = 1;
    return;
  }

  env_->InitializeLibuv(per_process::v8_is_profiling);
  env_->InitializeDiagnostics();
#if HAVE_INSPECTOR && NODE_USE_V8_PLATFORM
  *exit_code = env_->InitializeInspector(nullptr);
#endif
  if (*exit_code != 0) {
    return;
  }

  // Make sure that no request or handle is created during bootstrap -
  // if necessary those should be done in pre-exeuction.
  // TODO(joyeecheung): print handles/requests before aborting
  CHECK(env_->req_wrap_queue()->IsEmpty());
  CHECK(env_->handle_wrap_queue()->IsEmpty());

  env_->set_has_run_bootstrapping_code(true);

  return;
}

}  // namespace node
