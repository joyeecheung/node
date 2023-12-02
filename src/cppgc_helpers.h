#ifndef SRC_CPPGC_HELPERS_H_
#define SRC_CPPGC_HELPERS_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "cppgc/garbage-collected.h"
#include "env.h"
#include "memory_tracker.h"
#include "v8-cppgc.h"
#include "v8.h"

namespace node {

#define ASSIGN_OR_RETURN_UNWRAP_CPPGC(ptr, obj, ...)                           \
  do {                                                                         \
    DCHECK_GE(obj->InternalFieldCount(), kInternalFieldCount);                 \
    *ptr = static_cast<typename std::remove_reference<decltype(*ptr)>::type>(  \
        obj->GetAlignedPointerFromInternalField(kSlot));                       \
    if (*ptr == nullptr) return __VA_ARGS__;                                   \
  } while (0)

#define CPPGC_MIXIN_FIELDS()                                                   \
  Environment* env_;                                                           \
  v8::TracedReference<v8::Object> traced_reference_;

class CppgcMixin {
 public:
  enum { kEmbedderType, kSlot, kInternalFieldCount };
  template <typename T>
  static T* Unwrap(v8::Local<v8::Object> obj) {
    DCHECK_GE(obj->InternalFieldCount(), T::kInternalFieldCount);
    T* ptr = static_cast<T*>(obj->GetAlignedPointerFromInternalField(T::kSlot));
    return ptr;
  }
};

#define CPPGC_MIXIN_METHODS()                                                  \
  v8::Local<v8::Object> object() const {                                       \
    return traced_reference_.Get(env_->isolate());                             \
  }                                                                            \
  Environment* env() const { return env_; }

#define TRACE_CPPGC_OBJECT(visitor) visitor->Trace(traced_reference_);

#define INITIALIZE_CPPGC_OBJECT(env, obj, ptr)                                 \
  env_ = env;                                                                  \
  traced_reference_ = v8::TracedReference<v8::Object>(env->isolate(), obj);    \
  SetCppgcReference(env->isolate(), obj, ptr);

#define DEFAULT_CPPGC_TRACE()                                                  \
  void Trace(cppgc::Visitor* visitor) const { TRACE_CPPGC_OBJECT(visitor) }

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_BASE_OBJECT_H_
