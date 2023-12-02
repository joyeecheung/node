#ifndef SRC_CPPGC_HELPERS_H_
#define SRC_CPPGC_HELPERS_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <type_traits>  // std::remove_reference
#include "cppgc/garbage-collected.h"
#include "cppgc/name-provider.h"
#include "env.h"
#include "memory_tracker.h"
#include "v8-cppgc.h"
#include "v8.h"

namespace node {

#define ASSIGN_OR_RETURN_UNWRAP_CPPGC(ptr, obj, ...)                           \
  do {                                                                         \
    *ptr = CppgcMixin::Unwrap<                                                 \
        typename std::remove_reference<decltype(**ptr)>::type>(obj);           \
    if (*ptr == nullptr) return __VA_ARGS__;                                   \
  } while (0)

// TODO(joyeecheung): make it a class template?
class CppgcMixin : public cppgc::GarbageCollectedMixin {
 public:
  enum InternalFields { kEmbedderType = 0, kSlot, kInternalFieldCount };

  // This must not be a constructor but called in the child class constructor,
  // per cppgc::GarbageCollectedMixin rules.
  template <typename T>
  void InitializeCppgc(T* ptr, Environment* env, v8::Local<v8::Object> obj) {
    env_ = env;
    traced_reference_ = v8::TracedReference<v8::Object>(env->isolate(), obj);
    SetCppgcReference(env->isolate(), obj, ptr);
    // We are adding this additional slot to that BaseObject and cppgc-managed
    // objects share the same layout.
    CHECK_GE(obj->InternalFieldCount(), T::kInternalFieldCount);
    obj->SetAlignedPointerInInternalField(T::kSlot, ptr);
  }

  v8::Local<v8::Object> object() const {
    return traced_reference_.Get(env_->isolate());
  }

  Environment* env() const { return env_; }

  template <typename T>
  static T* Unwrap(v8::Local<v8::Object> obj) {
    // We are not using v8::Object::Unwrap currently because that requires
    // access to isolate which the ASSIGN_OR_RETURN_UNWRAP macro that we'll shim
    // with cppgc-allocated types doesn't take.
    if (obj->InternalFieldCount() != T::kInternalFieldCount) {
      return nullptr;
    }
    T* ptr = static_cast<T*>(obj->GetAlignedPointerFromInternalField(T::kSlot));
    return ptr;
  }

  void Trace(cppgc::Visitor* visitor) const override {
    visitor->Trace(traced_reference_);
  }

 private:
  Environment* env_;
  v8::TracedReference<v8::Object> traced_reference_;
};

#define DEFAULT_CPPGC_TRACE()                                                  \
  void Trace(cppgc::Visitor* visitor) const final {                            \
    CppgcMixin::Trace(visitor);                                                \
  }

#define SET_CPPGC_NAME(Klass)                                                  \
  inline const char* GetHumanReadableName() const final {                      \
    return "Node / " #Klass;                                                   \
  }
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_BASE_OBJECT_H_
