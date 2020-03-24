#ifndef SRC_ALIASED_BUFFER_H_
#define SRC_ALIASED_BUFFER_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cinttypes>
#include <unordered_set>
#include "util-inl.h"
#include "v8.h"

namespace node {

/**
 * Do not use this class directly when creating instances of it - use the
 * Aliased*Array defined at the end of this file instead.
 *
 * This class encapsulates the technique of having a native buffer mapped to
 * a JS object. Writes to the native buffer can happen efficiently without
 * going through JS, and the data is then available to user's via the exposed
 * JS object.
 *
 * While this technique is computationally efficient, it is effectively a
 * write to JS program state w/out going through the standard
 * (monitored) API. Thus any VM capabilities to detect the modification are
 * circumvented.
 *
 * The encapsulation herein provides a placeholder where such writes can be
 * observed. Any notification APIs will be left as a future exercise.
 */

enum class AliasedBufferType { kNew, kCopy, kShared, kAssigned, kDeserialized };

template <class NativeT,
          class V8T,
          // SFINAE NativeT to be scalar
          typename Trait = std::enable_if_t<std::is_scalar<NativeT>::value>>
class AliasedBufferBase {
 public:
  static std::unordered_set<AliasedBufferBase*> buffers;

  inline AliasedBufferBase(v8::Isolate* isolate, const size_t count)
      : isolate_(isolate),
        count_(count),
        byte_offset_(0),
        type_(AliasedBufferType::kNew) {
    buffers.insert(this);
    CHECK_GT(count, 0);
    const v8::HandleScope handle_scope(isolate_);
    const size_t size_in_bytes =
        MultiplyWithOverflowCheck(sizeof(NativeT), count);

    // allocate v8 ArrayBuffer
    v8::Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(
        isolate_, size_in_bytes);
    buffer_ = static_cast<NativeT*>(ab->GetBackingStore()->Data());

    // allocate v8 TypedArray
    v8::Local<V8T> js_array = V8T::New(ab, byte_offset_, count);
    js_array_ = v8::Global<V8T>(isolate, js_array);
  }

  /**
   * Create an AliasedBufferBase over a sub-region of another aliased buffer.
   * The two will share a v8::ArrayBuffer instance &
   * a native buffer, but will each read/write to different sections of the
   * native buffer.
   *
   *  Note that byte_offset must by aligned by sizeof(NativeT).
   */
  // TODO(refack): refactor into a non-owning `AliasedBufferBaseView`
  AliasedBufferBase(
      v8::Isolate* isolate,
      const size_t byte_offset,
      const size_t count,
      const AliasedBufferBase<uint8_t, v8::Uint8Array>& backing_buffer)
      : isolate_(isolate),
        count_(count),
        byte_offset_(byte_offset),
        type_(AliasedBufferType::kShared) {
    buffers.insert(this);
    const v8::HandleScope handle_scope(isolate_);

    v8::Local<v8::ArrayBuffer> ab = backing_buffer.GetArrayBuffer();

    // validate that the byte_offset is aligned with sizeof(NativeT)
    CHECK_EQ(byte_offset & (sizeof(NativeT) - 1), 0);
    // validate this fits inside the backing buffer
    CHECK_LE(MultiplyWithOverflowCheck(sizeof(NativeT), count),
             ab->ByteLength() - byte_offset);

    buffer_ = reinterpret_cast<NativeT*>(
        const_cast<uint8_t*>(backing_buffer.GetNativeBuffer() + byte_offset));

    v8::Local<V8T> js_array = V8T::New(ab, byte_offset, count);
    js_array_ = v8::Global<V8T>(isolate, js_array);
  }

  AliasedBufferBase(const AliasedBufferBase& that)
      : isolate_(that.isolate_),
        count_(that.count_),
        byte_offset_(that.byte_offset_),
        buffer_(that.buffer_),
        type_(AliasedBufferType::kCopy) {
    buffers.insert(this);
    js_array_ = v8::Global<V8T>(that.isolate_, that.GetJSArray());
  }

  inline ~AliasedBufferBase() { buffers.erase(this); }

  AliasedBufferBase& operator=(AliasedBufferBase&& that) noexcept {
    this->~AliasedBufferBase();
    isolate_ = that.isolate_;
    count_ = that.count_;
    byte_offset_ = that.byte_offset_;
    buffer_ = that.buffer_;

    js_array_.Reset(isolate_, that.js_array_.Get(isolate_));
    type_ = AliasedBufferType::kAssigned;

    that.buffer_ = nullptr;
    that.js_array_.Reset();
    return *this;
  }

  AliasedBufferBase& Deserialize(v8::Isolate* isolate,
                                 v8::Local<V8T> that) noexcept {
    this->~AliasedBufferBase();
    isolate_ = isolate;
    count_ = that->Length();
    byte_offset_ = that->ByteOffset();
    buffer_ = static_cast<NativeT*>(that->Buffer()->GetContents().Data());

    js_array_.Reset(isolate_, that);
    type_ = AliasedBufferType::kDeserialized;

    return *this;
  }

  /**
   * Helper class that is returned from operator[] to support assignment into
   * a specified location.
   */
  class Reference {
   public:
    Reference(AliasedBufferBase<NativeT, V8T>* aliased_buffer, size_t index)
        : aliased_buffer_(aliased_buffer), index_(index) {}

    Reference(const Reference& that)
        : aliased_buffer_(that.aliased_buffer_),
          index_(that.index_) {
    }

    inline Reference& operator=(const NativeT& val) {
      aliased_buffer_->SetValue(index_, val);
      return *this;
    }

    inline Reference& operator=(const Reference& val) {
      return *this = static_cast<NativeT>(val);
    }

    operator NativeT() const {
      return aliased_buffer_->GetValue(index_);
    }

    inline Reference& operator+=(const NativeT& val) {
      const NativeT current = aliased_buffer_->GetValue(index_);
      aliased_buffer_->SetValue(index_, current + val);
      return *this;
    }

    inline Reference& operator+=(const Reference& val) {
      return this->operator+=(static_cast<NativeT>(val));
    }

    inline Reference& operator-=(const NativeT& val) {
      const NativeT current = aliased_buffer_->GetValue(index_);
      aliased_buffer_->SetValue(index_, current - val);
      return *this;
    }

   private:
    AliasedBufferBase<NativeT, V8T>* aliased_buffer_;
    size_t index_;
  };

  /**
   *  Get the underlying v8 TypedArray overlayed on top of the native buffer
   */
  v8::Local<V8T> GetJSArray() const {
    return js_array_.Get(isolate_);
  }

  /**
  *  Get the underlying v8::ArrayBuffer underlying the TypedArray and
  *  overlaying the native buffer
  */
  v8::Local<v8::ArrayBuffer> GetArrayBuffer() const {
    return GetJSArray()->Buffer();
  }

  /**
   *  Get the underlying native buffer. Note that all reads/writes should occur
   *  through the GetValue/SetValue/operator[] methods
   */
  inline const NativeT* GetNativeBuffer() const {
    return buffer_;
  }

  /**
   *  Synonym for GetBuffer()
   */
  inline const NativeT* operator * () const {
    return GetNativeBuffer();
  }

  /**
   *  Set position index to given value.
   */
  inline void SetValue(const size_t index, NativeT value) {
    DCHECK_LT(index, count_);
    buffer_[index] = value;
  }

  /**
   *  Get value at position index
   */
  inline const NativeT GetValue(const size_t index) const {
    DCHECK_LT(index, count_);
    return buffer_[index];
  }

  /**
   *  Effectively, a synonym for GetValue/SetValue
   */
  Reference operator[](size_t index) {
    return Reference(this, index);
  }

  NativeT operator[](size_t index) const {
    return GetValue(index);
  }

  size_t Length() const {
    return count_;
  }

  // Should only be used to extend the array.
  // Should only be used on an owning array, not one created as a sub array of
  // an owning `AliasedBufferBase`.
  void reserve(size_t new_capacity) {
    DCHECK_GE(new_capacity, count_);
    DCHECK_EQ(byte_offset_, 0);
    const v8::HandleScope handle_scope(isolate_);

    const size_t old_size_in_bytes = sizeof(NativeT) * count_;
    const size_t new_size_in_bytes = sizeof(NativeT) * new_capacity;

    // allocate v8 new ArrayBuffer
    v8::Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(
        isolate_, new_size_in_bytes);

    // allocate new native buffer
    NativeT* new_buffer = static_cast<NativeT*>(ab->GetBackingStore()->Data());
    // copy old content
    memcpy(new_buffer, buffer_, old_size_in_bytes);

    // allocate v8 TypedArray
    v8::Local<V8T> js_array = V8T::New(ab, byte_offset_, new_capacity);

    // move over old v8 TypedArray
    js_array_ = std::move(v8::Global<V8T>(isolate_, js_array));

    buffer_ = new_buffer;
    count_ = new_capacity;
  }

  AliasedBufferType type() const { return type_; }

  typedef void (*AliasedBufferIterator)(AliasedBufferBase*, void* data);

  static void ForEachBuffer(AliasedBufferIterator iter, void* data) {
    for (const auto& item : buffers) {
      iter(item, data);
    }
  }

 private:
  v8::Isolate* isolate_;
  size_t count_;
  size_t byte_offset_;
  NativeT* buffer_;
  v8::Global<V8T> js_array_;
  AliasedBufferType type_;
};

template <class NativeT, class V8T, typename Trait>
std::unordered_set<AliasedBufferBase<NativeT, V8T, Trait>*>
    AliasedBufferBase<NativeT, V8T, Trait>::buffers;

#define ALIASED_BUFFER_TYPES(V)                                                \
  V(uint8_t, Uint8Array)                                                       \
  V(int32_t, Int32Array)                                                       \
  V(uint32_t, Uint32Array)                                                     \
  V(double, Float64Array)                                                      \
  V(uint64_t, BigUint64Array)

#define V(NativeT, V8T)                                                        \
  typedef AliasedBufferBase<NativeT, v8::V8T> Aliased##V8T;
ALIASED_BUFFER_TYPES(V)
#undef V
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_ALIASED_BUFFER_H_
