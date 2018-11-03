#ifndef SRC_NODE_NATIVE_MODULE_H_
#define SRC_NODE_NATIVE_MODULE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "node_internals.h"

namespace node {
namespace native_module {

class NativeModule {
 public:
  static void LoadBindings(Environment* env);
  static void GetNatives(Environment* env, v8::Local<v8::Object> exports);
  static void CompileCodeCache(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void CompileFunction(const v8::FunctionCallbackInfo<v8::Value>& args);
  static v8::Local<v8::Value> CompileAsModule(Environment* env,
                                              v8::Local<v8::String> id,
                                              bool produce_code_cache);

 private:
  static v8::Local<v8::Value> Compile(Environment* env,
                                      v8::Local<v8::String> id,
                                      v8::Local<v8::String>* parameters,
                                      size_t parameters_count,
                                      bool produce_code_cache);
};

}  // namespace native_module
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_NODE_NATIVE_MODULE_H_
