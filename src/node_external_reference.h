#ifndef SRC_NODE_EXTERNAL_REFERENCE_H_
#define SRC_NODE_EXTERNAL_REFERENCE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cinttypes>
#include <vector>

namespace node {

// This class manages the external references from the V8 heap
// to the C++ addresses in Node.js.
class ExternalReferenceRegistry {
 public:
  ExternalReferenceRegistry() {}

  template <typename T>
  void Register(T* address) {
    external_references_.push_back(reinterpret_cast<intptr_t>(address));
  }

  std::vector<intptr_t> external_references() const {
    std::vector<intptr_t> result = external_references_;
    result.push_back(reinterpret_cast<intptr_t>(nullptr));
    return result;
  }

 private:
  std::vector<intptr_t> external_references_;
};

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS
#endif  // SRC_NODE_EXTERNAL_REFERENCE_H_
