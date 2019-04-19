#ifndef SRC_NODE_MAIN_INSTANCE_H_
#define SRC_NODE_MAIN_INSTANCE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "node.h"
#include "util.h"
#include "uv.h"
#include "v8.h"

namespace node {

// TODO(joyeecheung): align this with the Worker/WorkerThreadData class.
// We may be able to create an abstract class to reuse some of the routines.
class NodeMainInstance {
 public:
  NodeMainInstance(const NodeMainInstance&) = delete;
  NodeMainInstance& operator=(const NodeMainInstance&) = delete;
  NodeMainInstance(NodeMainInstance&&) = delete;
  NodeMainInstance& operator=(NodeMainInstance&&) = delete;

  // To create a main instance that does not own the isoalte,
  // The caller needs to do:
  //
  //   Isolate* isoalte = NodeMainInstance::AllocateIsolate(loop);
  //   isolate->Initialize(...);
  //   NodeMainInstance* main_instance =
  //       NodeMainInstance::Create(isolate, loop, args, exec_args);
  //
  // When tearing it down:
  //
  //   main_instance->Cleanup();  // While the isolate is entered
  //   isolate->Exit();
  //   isolate->Dispose();
  //   main_instance->Dispose();
  //
  // After calling Dispose() the main_instance is no longer accessible.
  static v8::Isolate* AllocateIsolate(uv_loop_t* event_loop);
  static NodeMainInstance* Create(v8::Isolate* isolate,
                                  uv_loop_t* event_loop,
                                  const std::vector<std::string>& args,
                                  const std::vector<std::string>& exec_args);
  void Cleanup();
  void Dispose();

  // Create a main instance that owns the isoalte
  NodeMainInstance(uv_loop_t* event_loop,
                   const std::vector<std::string>& args,
                   const std::vector<std::string>& exec_args);
  ~NodeMainInstance();
  void reset_isolate(v8::Isolate* isolate) { isolate_ = isolate; }
  v8::Isolate* isolate() { return isolate_; }
  IsolateData* isolate_data() { return isolate_data_.get(); }

  // Start running the Node.js instances, return the exit code when finished.
  int Run();

  // TODO(joyeecheung): align this with the CreateEnvironment exposed in node.h
  // and the environment creation routine in workers somehow.
  std::unique_ptr<Environment> CreateMainEnvironment(int* exit_code);

 private:
  NodeMainInstance(v8::Isolate* isolate,
                   uv_loop_t* event_loop,
                   const std::vector<std::string>& args,
                   const std::vector<std::string>& exec_args);
  std::vector<std::string> args_;
  std::vector<std::string> exec_args_;
  std::unique_ptr<ArrayBufferAllocator> array_buffer_allocator_;
  v8::Isolate* isolate_;
  std::unique_ptr<IsolateData> isolate_data_;
  bool owns_isolate_ = false;
};

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_MAIN_INSTANCE_H_
