#include <node.h>
#include <v8.h>
#include <cppgc/garbage-collected.h>
#include <cppgc/allocation.h>
#include <cppgc/heap.h>
#include <v8-cppgc.h>

class CppGCed : public cppgc::GarbageCollected<CppGCed> {
 public:
  static uint16_t states[2];
  static constexpr int kDestructCount = 0;
  static constexpr int kTraceCount = 1;

  static v8::Global<v8::ObjectTemplate> internal_object_template;

  static void New(const v8::FunctionCallbackInfo<v8::Value>& args) {
    v8::Isolate* isolate = args.GetIsolate();
    v8::Local<v8::Object> js_object = args.This();
    v8::HandleScope scope(isolate);
    CppGCed* gc_object = cppgc::MakeGarbageCollected<CppGCed>(
        isolate->GetCppHeap()->GetAllocationHandle());
    node::TraceWithCppGC(js_object, gc_object);
    args.GetReturnValue().Set(js_object);
  }

  CppGCed() = default;

  ~CppGCed() {
    states[kDestructCount]++;
  }

  void Trace(cppgc::Visitor* visitor) const {
    states[kTraceCount]++;
  }
};

uint16_t CppGCed::states[] = {0, 0};

void InitModule(v8::Local<v8::Object> exports) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  auto context = isolate->GetCurrentContext();

  auto ft = v8::FunctionTemplate::New(isolate, CppGCed::New);
  ft->SetClassName(
      v8::String::NewFromUtf8(isolate, "CppGCed").ToLocalChecked());
  auto ot = ft->InstanceTemplate();
  ot->SetInternalFieldCount(2);

  auto store =
          v8::ArrayBuffer::NewBackingStore(CppGCed::states,
                                           sizeof(uint16_t) * 2,
                                           [](void*, size_t, void*) {},
                                           nullptr);
  auto ab = v8::ArrayBuffer::New(isolate, std::move(store));

  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "CppGCed").ToLocalChecked(),
               ft->GetFunction(context).ToLocalChecked());
  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "states").ToLocalChecked(),
               v8::Uint16Array::New(ab, 0, 2));
  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "kDestructCount").ToLocalChecked(),
               v8::Integer::New(isolate, CppGCed::kDestructCount));
  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "kTraceCount").ToLocalChecked(),
               v8::Integer::New(isolate, CppGCed::kTraceCount));
}

NODE_MODULE(NODE_GYP_MODULE_NAME, InitModule)
