#include "node_main_instance.h"

namespace node {

const v8::StartupData* NodeMainInstance::GetEmbeddedSnapshotBlob() {
  return nullptr;
}

const NodeMainInstance::IndexArray* NodeMainInstance::GetIsolateDataIndexes() {
  return nullptr;
}

}  // namespace node
