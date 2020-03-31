#ifndef SRC_SNAPSHOT_SUPPORT_H_
#define SRC_SNAPSHOT_SUPPORT_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "v8.h"
#include <map>

namespace node {

class ExternalReferences {
 public:
  template <typename... Args>
  inline ExternalReferences(const char* id, Args*... args);

  void AddPointer(intptr_t ptr);

  // Returns the list of all references collected so far, not yet terminated
  // by kEnd.
  static std::vector<intptr_t> get_list();

  static const intptr_t kEnd;

 private:
  void Register(const char* id, ExternalReferences* self);
  static std::map<std::string, ExternalReferences*>* map();
  std::vector<intptr_t> references_;

  inline void HandleArgs();
  template <typename T, typename... Args>
  inline void HandleArgs(T* ptr, Args*... args);
};

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_SNAPSHOT_SUPPORT_H_
