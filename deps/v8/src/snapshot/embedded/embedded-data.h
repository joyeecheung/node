// Copyright 2018 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef V8_SNAPSHOT_EMBEDDED_EMBEDDED_DATA_H_
#define V8_SNAPSHOT_EMBEDDED_EMBEDDED_DATA_H_

#include "src/base/macros.h"
#include "src/builtins/builtins.h"
#include "src/common/globals.h"
#include "src/execution/isolate.h"

namespace v8 {
namespace internal {

class Code;
class Isolate;

// Wraps an off-heap instruction stream.
// TODO(jgruber,v8:6666): Remove this class.
class InstructionStream final : public AllStatic {
 public:
  // Returns true, iff the given pc points into an off-heap instruction stream.
  static bool PcIsOffHeap(Isolate* isolate, Address pc);

  // Returns the corresponding Code object if it exists, and nullptr otherwise.
  static Code TryLookupCode(Isolate* isolate, Address address);

  // During snapshot creation, we first create an executable off-heap area
  // containing all off-heap code. The area is guaranteed to be contiguous.
  // Note that this only applies when building the snapshot, e.g. for
  // mksnapshot. Otherwise, off-heap code is embedded directly into the binary.
  static void CreateOffHeapInstructionStream(Isolate* isolate, uint8_t** code,
                                             uint32_t* code_size,
                                             uint8_t** data,
                                             uint32_t* data_size);
  static void FreeOffHeapInstructionStream(uint8_t* code, uint32_t code_size,
                                           uint8_t* data, uint32_t data_size);
};

class EmbeddedData final {
 public:
  static EmbeddedData FromIsolate(Isolate* isolate);

  static EmbeddedData FromBlob() {
    return EmbeddedData(Isolate::CurrentEmbeddedBlobCode(),
                        Isolate::CurrentEmbeddedBlobCodeSize(),
                        Isolate::CurrentEmbeddedBlobData(),
                        Isolate::CurrentEmbeddedBlobDataSize());
  }

  static EmbeddedData FromBlob(Isolate* isolate) {
    return EmbeddedData(
        isolate->embedded_blob_code(), isolate->embedded_blob_code_size(),
        isolate->embedded_blob_data(), isolate->embedded_blob_data_size());
  }

  const uint8_t* code() const { return code_; }
  uint32_t code_size() const { return code_size_; }
  const uint8_t* data() const { return data_; }
  uint32_t data_size() const { return data_size_; }

  void Dispose() {
    delete[] code_;
    code_ = nullptr;
    delete[] data_;
    data_ = nullptr;
  }

  Address InstructionStartOfBuiltin(int i) const;
  uint32_t InstructionSizeOfBuiltin(int i) const;

  Address InstructionStartOfBytecodeHandlers() const;
  Address InstructionEndOfBytecodeHandlers() const;

  Address MetadataStartOfBuiltin(int i) const;
  uint32_t MetadataSizeOfBuiltin(int i) const;

  uint32_t AddressForHashing(Address addr) {
    Address start = reinterpret_cast<Address>(code_);
    DCHECK(base::IsInRange(addr, start, start + code_size_));
    return static_cast<uint32_t>(addr - start);
  }

  // Padded with kCodeAlignment.
  // TODO(v8:11045): Consider removing code alignment.
  uint32_t PaddedInstructionSizeOfBuiltin(int i) const {
    STATIC_ASSERT(Code::kOffHeapBodyIsContiguous);
    uint32_t size = InstructionSizeOfBuiltin(i) + MetadataSizeOfBuiltin(i);
    CHECK_NE(size, 0);
    return PadAndAlign(size);
  }

  size_t CreateEmbeddedBlobHash() const;
  size_t EmbeddedBlobHash() const {
    return *reinterpret_cast<const size_t*>(data_ + EmbeddedBlobHashOffset());
  }

  size_t IsolateHash() const {
    return *reinterpret_cast<const size_t*>(data_ + IsolateHashOffset());
  }

  // Blob layout information for a single instruction stream. Corresponds
  // roughly to Code object layout (see the instruction and metadata area).
  struct LayoutDescription {
    // The offset and (unpadded) length of this builtin's instruction area
    // from the start of the embedded code section.
    uint32_t instruction_offset;
    uint32_t instruction_length;
    // The offset and (unpadded) length of this builtin's metadata area
    // from the start of the embedded code section.
    uint32_t metadata_offset;
    uint32_t metadata_length;
  };
  STATIC_ASSERT(offsetof(LayoutDescription, instruction_offset) ==
                0 * kUInt32Size);
  STATIC_ASSERT(offsetof(LayoutDescription, instruction_length) ==
                1 * kUInt32Size);
  STATIC_ASSERT(offsetof(LayoutDescription, metadata_offset) ==
                2 * kUInt32Size);
  STATIC_ASSERT(offsetof(LayoutDescription, metadata_length) ==
                3 * kUInt32Size);
  STATIC_ASSERT(sizeof(LayoutDescription) == 4 * kUInt32Size);

  // The layout of the blob is as follows:
  //
  // data:
  // [0] hash of the remaining blob
  // [1] hash of embedded-blob-relevant heap objects
  // [2] layout description of instruction stream 0
  // ... layout descriptions
  //
  // code:
  // [0] instruction stream 0
  // ... instruction streams

  static constexpr uint32_t kTableSize = Builtins::builtin_count;
  static constexpr uint32_t EmbeddedBlobHashOffset() { return 0; }
  static constexpr uint32_t EmbeddedBlobHashSize() { return kSizetSize; }
  static constexpr uint32_t IsolateHashOffset() {
    return EmbeddedBlobHashOffset() + EmbeddedBlobHashSize();
  }
  static constexpr uint32_t IsolateHashSize() { return kSizetSize; }
  static constexpr uint32_t LayoutDescriptionTableOffset() {
    return IsolateHashOffset() + IsolateHashSize();
  }
  static constexpr uint32_t LayoutDescriptionTableSize() {
    return sizeof(struct LayoutDescription) * kTableSize;
  }
  static constexpr uint32_t RawCodeOffset() { return 0; }

 private:
  EmbeddedData(const uint8_t* code, uint32_t code_size, const uint8_t* data,
               uint32_t data_size)
      : code_(code), code_size_(code_size), data_(data), data_size_(data_size) {
    DCHECK_NOT_NULL(code);
    DCHECK_LT(0, code_size);
    DCHECK_NOT_NULL(data);
    DCHECK_LT(0, data_size);
  }

  const LayoutDescription* LayoutDescription() const {
    return reinterpret_cast<const struct LayoutDescription*>(
        data_ + LayoutDescriptionTableOffset());
  }
  const uint8_t* RawCode() const { return code_ + RawCodeOffset(); }

  static constexpr int PadAndAlign(int size) {
    // Ensure we have at least one byte trailing the actual builtin
    // instructions which we can later fill with int3.
    return RoundUp<kCodeAlignment>(size + 1);
  }

  void PrintStatistics() const;

  // This points to code for builtins. The contents are potentially unreadable
  // on platforms that disallow reads from the .text section.
  const uint8_t* code_;
  uint32_t code_size_;

  // The data section contains both descriptions of the code section (hashes,
  // offsets, sizes) and metadata describing Code objects (see
  // Code::MetadataStart()).
  const uint8_t* data_;
  uint32_t data_size_;
};

}  // namespace internal
}  // namespace v8

#endif  // V8_SNAPSHOT_EMBEDDED_EMBEDDED_DATA_H_
