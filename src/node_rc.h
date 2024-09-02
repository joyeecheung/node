#ifndef SRC_NODE_RC_H_
#define SRC_NODE_RC_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <string>
#include <filesystem>

namespace node {

class RuntimeConfig {
 public:
  static void Initialize(std::filesystem::path base);
  static bool initialized_;  // This can only be initialized once per process.
};

namespace per_process {
std::string node_rc_raw_json;
RuntimeConfig config;
}

void InitializeNodeRC();
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_NODE_RC_H_
