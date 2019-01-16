#ifndef SRC_NODE_V8_PLATFORM_H_
#define SRC_NODE_V8_PLATFORM_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "env.h"
#include "tracing/agent.h"
#include "node_platform.h"

namespace node {
// Ensures that __metadata trace events are only emitted
// when tracing is enabled.
class NodeTraceStateObserver
    : public v8::TracingController::TraceStateObserver {
 public:
  inline void OnTraceEnabled() override;
  inline void OnTraceDisabled() override;
  explicit NodeTraceStateObserver(v8::TracingController* controller)
      : controller_(controller) {}
  ~NodeTraceStateObserver() override {}

 private:
  v8::TracingController* controller_;
};

struct V8Platform {
#if NODE_USE_V8_PLATFORM
  inline void Initialize(int thread_pool_size);
  inline void Dispose();
  inline void DrainVMTasks(v8::Isolate* isolate);
  inline void CancelVMTasks(v8::Isolate* isolate);

#if HAVE_INSPECTOR
  inline bool StartInspector(Environment* env, const char* script_path);
  inline bool InspectorStarted(Environment* env);
#endif  // HAVE_INSPECTOR

  inline void StartTracingAgent();
  inline void StopTracingAgent();
  inline tracing::AgentWriterHandle* GetTracingAgentWriter();
  inline NodePlatform* Platform();

  std::unique_ptr<NodeTraceStateObserver> trace_state_observer_;
  std::unique_ptr<tracing::Agent> tracing_agent_;
  tracing::AgentWriterHandle tracing_file_writer_;
  NodePlatform* platform_;
#else   // !NODE_USE_V8_PLATFORM
  void Initialize(int thread_pool_size) {}
  void Dispose() {}
  void DrainVMTasks(v8::Isolate* isolate) {}
  void CancelVMTasks(v8::Isolate* isolate) {}
  bool StartInspector(Environment* env, const char* script_path) {
    env->ThrowError("Node compiled with NODE_USE_V8_PLATFORM=0");
    return true;
  }
  void StartTracingAgentStartTracingAgent() {
    if (!trace_enabled_categories.empty()) {
      fprintf(stderr,
              "Node compiled with NODE_USE_V8_PLATFORM=0, "
              "so event tracing is not available.\n");
    }
  }
  void StopTracingAgent() {}
  tracing::AgentWriterHandle* GetTracingAgentWriter() { return nullptr; }
  NodePlatform* Platform() { return nullptr; }
#endif  // !NODE_USE_V8_PLATFORM

#if !NODE_USE_V8_PLATFORM || !HAVE_INSPECTOR
  bool InspectorStarted(Environment* env) { return false; }
#endif  //  !NODE_USE_V8_PLATFORM || !HAVE_INSPECTOR
};

namespace per_process {
extern struct V8Platform v8_platform;
// Tells whether --prof is passed.
extern bool v8_is_profiling;
}  // namespace per_process

inline tracing::AgentWriterHandle* GetTracingAgentWriter();
inline void DisposePlatform();

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_NODE_V8_PLATFORM_H_
