#include "cppgc/allocation.h"
#include "cppgc_helpers.h"
#include "env-inl.h"
#include "memory_tracker-inl.h"

namespace node {
namespace example_object {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

class ExampleBaseObject : public BaseObject {
 public:
  ExampleBaseObject(Environment* env, Local<Object> obj)
      : BaseObject(env, obj) {
    MakeWeak();
  }
  SET_MEMORY_INFO_NAME(ExampleBaseObject)
  SET_SELF_SIZE(ExampleBaseObject)
  SET_NO_MEMORY_INFO()

  static void New(const FunctionCallbackInfo<Value>& args) {
    Environment* env = Environment::GetCurrent(args);
    new ExampleBaseObject(env, args.This());
  }

  CONSTRUCTOR_TEMPLATE_GENERATOR(example_base_object, ExampleBaseObject)
};

class ExampleCppgcObject final
    : public cppgc::GarbageCollected<ExampleCppgcObject>,
      public MemoryRetainer,
      public CppgcMixin {
 public:
  CPPGC_MIXIN_METHODS()
  DEFAULT_CPPGC_TRACE()

  ExampleCppgcObject(Environment* env,
                     Local<Object> obj){INITIALIZE_CPPGC_OBJECT(env, obj, this)}

  SET_MEMORY_INFO_NAME(ExampleCppgcObject) SET_SELF_SIZE(ExampleCppgcObject)
      SET_NO_MEMORY_INFO()

          static void New(const FunctionCallbackInfo<Value>& args) {
    Environment* env = Environment::GetCurrent(args);
    Isolate* isolate = args.GetIsolate();
    cppgc::MakeGarbageCollected<ExampleCppgcObject>(
        isolate->GetCppHeap()->GetAllocationHandle(), env, args.This());
  }

  CONSTRUCTOR_TEMPLATE_GENERATOR(example_cppgc_object, ExampleCppgcObject)

 private:
  CPPGC_MIXIN_FIELDS()
};

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  Environment* env = Environment::GetCurrent(context);
  {
    auto tmpl = ExampleCppgcObject::GetConstructorTemplate(env->isolate_data());
    SetConstructorFunction(context, target, "ExampleCppgcObject", tmpl);
  }
  {
    auto tmpl = ExampleBaseObject::GetConstructorTemplate(env->isolate_data());
    SetConstructorFunction(context, target, "ExampleBaseObject", tmpl);
  }
}

}  // namespace example_object
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(example_object,
                                    node::example_object::Initialize)
