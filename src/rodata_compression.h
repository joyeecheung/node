#ifndef SRC_READ_ONLY_DATA_COMPRESSION_H_
#define SRC_READ_ONLY_DATA_COMPRESSION_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "lz4.h"

namespace node {

enum class RODataCompression { kNone, kLZ4 };
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_READ_ONLY_DATA_COMPRESSION_H_
