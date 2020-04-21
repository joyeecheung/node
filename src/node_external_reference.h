#ifndef SRC_NODE_EXTERNAL_REFERENCE_H_
#define SRC_NODE_EXTERNAL_REFERENCE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cinttypes>
#include <vector>
#include "v8.h"

namespace node {

// This class manages the external references from the V8 heap
// to the C++ addresses in Node.js.
class ExternalReferenceRegistry {
 public:
  ExternalReferenceRegistry() {}

#define ALLOWED_EXTERNAL_REFERENCE_TYPES(V)                                    \
  V(v8::FunctionCallback)                                                      \
  V(v8::AccessorGetterCallback)                                                \
  V(v8::AccessorSetterCallback)                                                \
  V(v8::AccessorNameGetterCallback)                                            \
  V(v8::AccessorNameSetterCallback)                                            \
  V(v8::GenericNamedPropertyDefinerCallback)                                   \
  V(v8::GenericNamedPropertyDeleterCallback)                                   \
  V(v8::GenericNamedPropertyEnumeratorCallback)                                \
  V(v8::GenericNamedPropertyQueryCallback)                                     \
  V(v8::GenericNamedPropertySetterCallback)

#define V(ExternalReferenceType)                                               \
  void Register(ExternalReferenceType addr) { RegisterT(addr); }
  ALLOWED_EXTERNAL_REFERENCE_TYPES(V)
#undef V

  // This can be called only once.
  const std::vector<intptr_t>& external_references();

  bool is_empty() { return external_references_.empty(); }

 private:
  template <typename T>
  void RegisterT(T* address) {
    external_references_.push_back(reinterpret_cast<intptr_t>(address));
  }
  bool is_finalized_ = false;
  std::vector<intptr_t> external_references_;
};
namespace errors {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
#if HAVE_INSPECTOR
namespace inspector {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
#endif  // HAVE_INSPECTOR
namespace Buffer {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
namespace credentials {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
namespace i18n {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
namespace task_queue {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
namespace url {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
namespace util {
void RegisterExternalReferences(ExternalReferenceRegistry* registry);
}
void RegisterNodeCategorySetExternalReferences(
    ExternalReferenceRegistry* registry);
void RegisterProcessMethodsExternalReferences(
    ExternalReferenceRegistry* registry);
void RegisterTypesExternalReferences(ExternalReferenceRegistry* registry);
void RegisterStringDecoderExternalReferences(
    ExternalReferenceRegistry* registry);
void RegisterTimerExternalReferences(ExternalReferenceRegistry* registry);
void RegisterEnvVarExternalReferences(ExternalReferenceRegistry* registry);
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_EXTERNAL_REFERENCE_H_
