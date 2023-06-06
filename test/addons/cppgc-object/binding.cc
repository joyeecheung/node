#include <cppgc/allocation.h>
#include <cppgc/garbage-collected.h>
#include <cppgc/heap.h>
#include <node.h>
#include <v8-cppgc.h>
#include <v8.h>

class CppGCed : public cppgc::GarbageCollected<CppGCed> {
 public:
  static uint16_t states[2];
  static const uint16_t kNodeEmbedderIdForCppgc;
  static constexpr int kDestructCount = 0;
  static constexpr int kTraceCount = 1;

  static v8::Global<v8::ObjectTemplate> internal_object_template;

  static void TraceWithCppGC(v8::Local<v8::Object> js_object,
                             void* garbage_collected) {
    js_object->SetAlignedPointerInInternalField(
        0, const_cast<uint16_t*>(&kNodeEmbedderIdForCppgc));
    js_object->SetAlignedPointerInInternalField(1, garbage_collected);
  }

  static void New(const v8::FunctionCallbackInfo<v8::Value>& args) {
    v8::Isolate* isolate = args.GetIsolate();
    v8::Local<v8::Object> js_object = args.This();
    v8::HandleScope scope(isolate);
    CppGCed* gc_object = cppgc::MakeGarbageCollected<CppGCed>(
        isolate->GetCppHeap()->GetAllocationHandle());
    TraceWithCppGC(js_object, gc_object);
    args.GetReturnValue().Set(js_object);
  }

  CppGCed() = default;

  ~CppGCed() { states[kDestructCount]++; }

  void Trace(cppgc::Visitor* visitor) const { states[kTraceCount]++; }
};

uint16_t CppGCed::states[] = {0, 0};
// TODO: this hard-coding would not be necessary if V8
// introduces a better API to address multi-tenancy cppgc-tracing:
// https://bugs.chromium.org/p/v8/issues/detail?id=13960
const uint16_t CppGCed::kNodeEmbedderIdForCppgc = 0x90de + 1;

void InitModule(v8::Local<v8::Object> exports) {
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  auto context = isolate->GetCurrentContext();

  auto ft = v8::FunctionTemplate::New(isolate, CppGCed::New);
  ft->SetClassName(
      v8::String::NewFromUtf8(isolate, "CppGCed").ToLocalChecked());
  auto ot = ft->InstanceTemplate();
  ot->SetInternalFieldCount(2);

  auto store = v8::ArrayBuffer::NewBackingStore(
      CppGCed::states,
      sizeof(uint16_t) * 2,
      [](void*, size_t, void*) {},
      nullptr);
  auto ab = v8::ArrayBuffer::New(isolate, std::move(store));

  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "CppGCed").ToLocalChecked(),
               ft->GetFunction(context).ToLocalChecked()).FromJust();
  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "states").ToLocalChecked(),
               v8::Uint16Array::New(ab, 0, 2)).FromJust();
  exports->Set(
      context,
      v8::String::NewFromUtf8(isolate, "kDestructCount").ToLocalChecked(),
      v8::Integer::New(isolate, CppGCed::kDestructCount)).FromJust();
  exports->Set(context,
               v8::String::NewFromUtf8(isolate, "kTraceCount").ToLocalChecked(),
               v8::Integer::New(isolate, CppGCed::kTraceCount)).FromJust();
}

NODE_MODULE(NODE_GYP_MODULE_NAME, InitModule)
