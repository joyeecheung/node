#include "node_v8_platform.h"
#include "node.h"
#include "node_internals.h"
#include "node_metadata.h"
#include "node_options.h"
#include "tracing/node_trace_writer.h"
#include "tracing/traced_value.h"

namespace node {

using v8::Isolate;
using v8::V8;

// Ensures that __metadata trace events are only emitted
// when tracing is enabled.

void NodeTraceStateObserver::OnTraceEnabled() {
  char name_buffer[512];
  if (uv_get_process_title(name_buffer, sizeof(name_buffer)) == 0) {
    // Only emit the metadata event if the title can be retrieved
    // successfully. Ignore it otherwise.
    TRACE_EVENT_METADATA1(
        "__metadata", "process_name", "name", TRACE_STR_COPY(name_buffer));
  }
  TRACE_EVENT_METADATA1("__metadata",
                        "version",
                        "node",
                        per_process::metadata.versions.node.c_str());
  TRACE_EVENT_METADATA1(
      "__metadata", "thread_name", "name", "JavaScriptMainThread");

  auto trace_process = tracing::TracedValue::Create();
  trace_process->BeginDictionary("versions");

#define V(key)                                                                 \
  trace_process->SetString(#key, per_process::metadata.versions.key.c_str());

  NODE_VERSIONS_KEYS(V)
#undef V

  trace_process->EndDictionary();

  trace_process->SetString("arch", per_process::metadata.arch.c_str());
  trace_process->SetString("platform", per_process::metadata.platform.c_str());

  trace_process->BeginDictionary("release");
  trace_process->SetString("name", per_process::metadata.release.name.c_str());
#if NODE_VERSION_IS_LTS
  trace_process->SetString("lts", per_process::metadata.release.lts.c_str());
#endif
  trace_process->EndDictionary();
  TRACE_EVENT_METADATA1(
      "__metadata", "node", "process", std::move(trace_process));

  // This only runs the first time tracing is enabled
  controller_->RemoveTraceStateObserver(this);
}

void NodeTraceStateObserver::OnTraceDisabled() {
  // Do nothing here. This should never be called because the
  // observer removes itself when OnTraceEnabled() is called.
  UNREACHABLE();
}

#if NODE_USE_V8_PLATFORM
void V8Platform::Initialize(int thread_pool_size) {
  tracing_agent_.reset(new tracing::Agent());
  node::tracing::TraceEventHelper::SetAgent(tracing_agent_.get());
  node::tracing::TracingController* controller =
      tracing_agent_->GetTracingController();
  trace_state_observer_.reset(new NodeTraceStateObserver(controller));
  controller->AddTraceStateObserver(trace_state_observer_.get());
  StartTracingAgent();
  // Tracing must be initialized before platform threads are created.
  platform_ = new NodePlatform(thread_pool_size, controller);
  V8::InitializePlatform(platform_);
}

void V8Platform::Dispose() {
  StopTracingAgent();
  platform_->Shutdown();
  delete platform_;
  platform_ = nullptr;
  // Destroy tracing after the platform (and platform threads) have been
  // stopped.
  tracing_agent_.reset(nullptr);
  trace_state_observer_.reset(nullptr);
}

void V8Platform::DrainVMTasks(Isolate* isolate) {
  platform_->DrainTasks(isolate);
}

void V8Platform::CancelVMTasks(Isolate* isolate) {
  platform_->CancelPendingDelayedTasks(isolate);
}

#if HAVE_INSPECTOR
bool V8Platform::StartInspector(Environment* env, const char* script_path) {
  // Inspector agent can't fail to start, but if it was configured to listen
  // right away on the websocket port and fails to bind/etc, this will return
  // false.
  return env->inspector_agent()->Start(
      script_path == nullptr ? "" : script_path,
      env->options()->debug_options(),
      env->inspector_host_port(),
      true);
}

bool V8Platform::InspectorStarted(Environment* env) {
  return env->inspector_agent()->IsListening();
}
#endif  // HAVE_INSPECTOR

void V8Platform::StartTracingAgent() {
  if (per_process::cli_options->trace_event_categories.empty()) {
    tracing_file_writer_ = tracing_agent_->DefaultHandle();
  } else {
    std::vector<std::string> categories =
        SplitString(per_process::cli_options->trace_event_categories, ',');

    tracing_file_writer_ = tracing_agent_->AddClient(
        std::set<std::string>(std::make_move_iterator(categories.begin()),
                              std::make_move_iterator(categories.end())),
        std::unique_ptr<tracing::AsyncTraceWriter>(new tracing::NodeTraceWriter(
            per_process::cli_options->trace_event_file_pattern)),
        tracing::Agent::kUseDefaultCategories);
  }
}

void V8Platform::StopTracingAgent() {
  tracing_file_writer_.reset();
}

tracing::AgentWriterHandle* V8Platform::GetTracingAgentWriter() {
  return &tracing_file_writer_;
}

NodePlatform* V8Platform::Platform() {
  return platform_;
}
#endif  // NODE_USE_V8_PLATFORM

tracing::AgentWriterHandle* GetTracingAgentWriter() {
  return per_process::v8_platform.GetTracingAgentWriter();
}

void DisposePlatform() {
  per_process::v8_platform.Dispose();
}

}  // namespace node
