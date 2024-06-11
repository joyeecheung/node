// Copyright 2014 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "src/snapshot/snapshot-source-sink.h"

#include <vector>

#include "src/base/logging.h"
#include "src/handles/handles-inl.h"
#include "src/objects/objects-inl.h"

namespace v8 {
namespace internal {

// constexpr uint32_t anchor = 0x11edf0 - (0x3a + 4 + 0x1016e4);
// constexpr uint32_t range = 16 * 16 * 3;

// bool IsInRange(size_t start, size_t end) {
//   // return start >= (anchor - range) && start <= anchor + range;
//   return start == 0x1d6d4 || start == 0x1d6e1;
// }

void SnapshotByteSink::Put(uint8_t b, const char* description) {
  // if (should_log_ && IsInRange(data_.size(), data_.size() + 1)) {
  //   PrintF("0x%lx SnapshotByteSink::Put(%s) %d\n", data_.size(), description, b);
  // }
  data_.push_back(b);
}

void SnapshotByteSink::PutN(int number_of_bytes, const uint8_t v,
                            const char* description) {
  // if (should_log_ && IsInRange(data_.size(), data_.size() + number_of_bytes)) {
  //   PrintF("0x%lx SnapshotByteSink::PutN(%s) %d * %d\n", data_.size(), description, v, number_of_bytes);
  // }
  data_.insert(data_.end(), number_of_bytes, v);
}

void SnapshotByteSink::PutUint30(uint32_t integer, const char* description) {
  // if (should_log_ && IsInRange(data_.size(), data_.size() + 4)) {
  //   PrintF("0x%lx SnapshotByteSink::PutUint30(%s) %d\n", data_.size(), description, integer);
  // }
  CHECK_LT(integer, 1UL << 30);
  integer <<= 2;
  int bytes = 1;
  if (integer > 0xFF) bytes = 2;
  if (integer > 0xFFFF) bytes = 3;
  if (integer > 0xFFFFFF) bytes = 4;
  integer |= (bytes - 1);
  bool temp = should_log_;
  should_log_ = false;
  Put(static_cast<uint8_t>(integer & 0xFF), "IntPart1");
  if (bytes > 1) Put(static_cast<uint8_t>((integer >> 8) & 0xFF), "IntPart2");
  if (bytes > 2) Put(static_cast<uint8_t>((integer >> 16) & 0xFF), "IntPart3");
  if (bytes > 3) Put(static_cast<uint8_t>((integer >> 24) & 0xFF), "IntPart4");
  should_log_ = temp;
}

void SnapshotByteSink::PutRaw(const uint8_t* data, int number_of_bytes,
                              const char* description) {
  // if (should_log_ && IsInRange(data_.size(), data_.size() + number_of_bytes)) {
  //   PrintF("0x%lx SnapshotByteSink::PutRaw(%s) %d: ", data_.size(), description, number_of_bytes);
  //   for (int i = 0; i < number_of_bytes; ++i) {
  //     PrintF("%d ", data[i]);
  //   }
  //   PrintF("\n");
  // }
#ifdef MEMORY_SANITIZER
  __msan_check_mem_is_initialized(data, number_of_bytes);
#endif
  data_.insert(data_.end(), data, data + number_of_bytes);
}

void SnapshotByteSink::Append(const SnapshotByteSink& other) {
  // if (should_log_ && IsInRange(data_.size(), data_.size() + other.data_.size())) {
  //   PrintF("0x%lx SnapshotByteSink::Append() %lu\n", data_.size(), other.data_.size());
  // }
  data_.insert(data_.end(), other.data_.begin(), other.data_.end());
}

int SnapshotByteSource::GetBlob(const uint8_t** data) {
  int size = GetUint30();
  CHECK_LE(position_ + size, length_);
  *data = &data_[position_];
  Advance(size);
  return size;
}
}  // namespace internal
}  // namespace v8
