#ifndef SRC_CONSTANT_TEMPLATE_H_
#define SRC_CONSTANT_TEMPLATE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <type_traits>
#include "v8-template.h"
#include "v8-value.h"
#include "v8-object.h"

namespace node {
// These are helpers that can be used on v8::Templates, they
// override existing helpers that work on v8::Objects.
#ifdef NODE_DEFINE_CONSTANT
#undef NODE_DEFINE_CONSTANT
#endif
#ifdef NODE_DEFINE_STRING_CONSTANT
#undef NODE_DEFINE_STRING_CONSTANT
#endif

template <typename T,
          std::enable_if_t<std::is_integral<T>::value>* = nullptr>
void DefineConstant(v8::Isolate* isolate, v8::Local<v8::ObjectTemplate> target, const char* name, T value) {
  target->Set(isolate, name,
              v8::Integer::New(isolate, value),
              static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete));
}

template <typename T,
          std::enable_if_t<std::is_enum<T>::value>* = nullptr>
void DefineConstant(v8::Isolate* isolate, v8::Local<v8::ObjectTemplate> target, const char* name, T value) {
  target->Set(isolate, name,
              v8::Integer::New(isolate, static_cast<int32_t>(value)),
              static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete));
}

void DefineStringConstant(v8::Isolate* isolate, v8::Local<v8::ObjectTemplate> target, const char* name, const char* value) {
  target->Set(isolate, name,
              v8::String::NewFromUtf8(isolate, value).ToLocalChecked(),
              static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete));
}

// To avoid modifying the call sites in bulk and mess up git history
// while being performant, these new helpers assume that there is already
// a v8::Isolate* named `isolate` in scope.
#define NODE_DEFINE_CONSTANT(target, constant)                                \
  DefineConstant(isolate, target, #constant, constant);

#define NODE_DEFINE_STRING_CONSTANT(target, name, constant)                                \
  DefineStringConstant(isolate, target, name, constant);

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_CONSTANT_TEMPLATE_H_
