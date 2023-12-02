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

// Similar to ASSIGN_OR_RETURN_UNWRAP() macro, but for cppgc objects.
#define ASSIGN_OR_RETURN_UNWRAP_CPPGC(ptr, obj, ...)                           \
  do {                                                                         \
    *ptr = CppgcMixin::Unwrap<                                                 \
        typename std::remove_reference<decltype(**ptr)>::type>(obj);           \
    if (*ptr == nullptr) return __VA_ARGS__;                                   \
  } while (0)

/**
 * This is a helper mixin with a BaseObject-like interface to help
 * implementing wrapper objects managed by V8's cppgc (Oilpan) library.
 * cppgc-manged objects in Node.js internals should extend this mixin,
 * while non-cppgc-managed objects typically extend BaseObject - the
 * latter are being migrated to be cppgc-managed wherever it's beneficial
 * and practical. Typically cppgc-managed objects are more efficient to
 * keep track of (which lowers initialization cost) and work better
 * with V8's GC scheduling.
 *
 * A cppgc-managed native wrapper should look something like this, note
 * that per cppgc rules, cppgc::GarbageCollected<> must be the left-most
 * base class.
 *
 * class Klass final : public cppgc::GarbageCollected<Klass>,
 *                     public cppgc::NameProvider,
 *                     public CppgcMixin {
 *  public:
 *   SET_CPPGC_NAME(Klass)  // Sets the heap snapshot name to "Node / Klass"
 *   void Trace(cppgc::Visitor* visitor) const final {
 *     CppgcMixin::Trace(visitor);
 *     visitor->Trace(...);  // Trace any additional owned traceable data
 *   }
 * }
 * TODO(joyeecheung): make it a class template?
 */
class CppgcMixin : public cppgc::GarbageCollectedMixin {
 public:
  // To help various callbacks access wrapper objects with different memory
  // management, cppgc-managed objects share the same layout as BaseObjects.
  enum InternalFields { kEmbedderType = 0, kSlot, kInternalFieldCount };

  // The initialization cannot be done in the mixin constructor but has to be
  // invoked from the child class constructor, per cppgc::GarbageCollectedMixin
  // rules.
  template <typename T>
  void InitializeCppgc(T* ptr, Environment* env, v8::Local<v8::Object> obj) {
    env_ = env;
    traced_reference_ = v8::TracedReference<v8::Object>(env->isolate(), obj);
    SetCppgcReference(env->isolate(), obj, ptr);
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
    // Since cppgc-managed objects share the same layout as BaseObjects, just
    // unwrap from the pointer in the internal field, which should be valid as
    // long as the object is still alive.
    if (obj->InternalFieldCount() != T::kInternalFieldCount) {
      return nullptr;
    }
    T* ptr = static_cast<T*>(obj->GetAlignedPointerFromInternalField(T::kSlot));
    return ptr;
  }

  // Subclasses are expected to invoke CppgcMixin::Trace() in their own Trace()
  // methods.
  void Trace(cppgc::Visitor* visitor) const override {
    visitor->Trace(traced_reference_);
  }

 private:
  Environment* env_;
  v8::TracedReference<v8::Object> traced_reference_;
};

// If the class doesn't have additional owned traceable data, use this macro to
// save the implementation of a custom Trace() method.
#define DEFAULT_CPPGC_TRACE()                                                  \
  void Trace(cppgc::Visitor* visitor) const final {                            \
    CppgcMixin::Trace(visitor);                                                \
  }

// This macro sets the node name in the heap snapshot with a "Node /" prefix.
// Classes that use this macro must extend cppgc::NameProvider.
#define SET_CPPGC_NAME(Klass)                                                  \
  inline const char* GetHumanReadableName() const final {                      \
    return "Node / " #Klass;                                                   \
  }
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_CPPGC_HELPERS_H_
