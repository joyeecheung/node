
#ifndef SRC_NODE_SERIALIZABLE_H_
#define SRC_NODE_SERIALIZABLE_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "base_object.h"

namespace node {

class Environment;
struct EnvSerializeInfo;

#define SERIALIZABLE_OBJECT_TYPES(V)                                           \
  V(fs_binding_data, fs::BindingData)                                          \
  V(v8_binding_data, v8_utils::BindingData)

enum class EmbedderObjectType : uint8_t {
  k_default = 0,
#define V(PropertyName, NativeType) k_##PropertyName,
  SERIALIZABLE_OBJECT_TYPES(V)
#undef V
};

// When serializing an embedder object, we'll serialize the native states
// into a chunk that can be mapped into a subclass of InternalFieldInfo,
// and pass it into the V8 callback as the payload of StartupData.
// TODO(joyeecheung): the classification of types seem to be wrong.
// We'd need a type for each field of each class of native object.
// Maybe it's fine - we'll just use the type to invoke BaseObject constructors
// and specify that the BaseObject has only one field for us to serialize.
// And for non-BaseObject embedder objects, we'll use field-wise types.
// The memory chunk looks like this:
//
// [   type   ] - EmbedderObjectType (a uint8_t)
// [  length  ] - a size_t
// [    ...   ] - custom bytes of size |length - header size|
struct InternalFieldInfo {
  EmbedderObjectType type;
  size_t length;

  InternalFieldInfo() = delete;

  static InternalFieldInfo* New(EmbedderObjectType type) {
    return New(type, sizeof(InternalFieldInfo));
  }

  static InternalFieldInfo* New(EmbedderObjectType type, size_t length) {
    InternalFieldInfo* result =
        reinterpret_cast<InternalFieldInfo*>(::operator new(length));
    result->type = type;
    result->length = length;
    return result;
  }

  InternalFieldInfo* Copy() const {
    InternalFieldInfo* result =
        reinterpret_cast<InternalFieldInfo*>(::operator new(length));
    memcpy(result, this, length);
    return result;
  }

  void Delete() { ::operator delete(this); }
};

class SerializableObject : public BaseObject {
 public:
  SerializableObject(Environment* env,
                     v8::Local<v8::Object> wrap,
                     EmbedderObjectType type = EmbedderObjectType::k_default);
  v8::Local<v8::String> GetTypeName() const;
  const char* GetTypeNameChars() const;

  virtual void PrepareForSerialization(v8::Local<v8::Context> context,
                                       v8::SnapshotCreator* creator) = 0;
  virtual InternalFieldInfo* Serialize() = 0;
  // We'll make sure that the type is set in the constructor
  EmbedderObjectType type() { return type_; }

 private:
  EmbedderObjectType type_;
};

// TODO(joyeecheung): to deal with multi-slot embedder objects, Serialize()
// and Deserialize() can take an index as argument.
#define SERIALIZABLE_OBJECT_METHODS()                                          \
  virtual void PrepareForSerialization(v8::Local<v8::Context> context,         \
                                       v8::SnapshotCreator* creator) override; \
  virtual InternalFieldInfo* Serialize() override;                             \
  static void Deserialize(v8::Local<v8::Context> context,                      \
                          v8::Local<v8::Object> holder,                        \
                          InternalFieldInfo* info);

v8::StartupData SerializeNodeContextInternalFields(v8::Local<v8::Object> holder,
                                                   int index,
                                                   void* env);
void DeserializeNodeInternalFields(v8::Local<v8::Object> holder,
                                   int index,
                                   v8::StartupData payload,
                                   void* env);
void SerializeBindingData(Environment* env,
                          v8::SnapshotCreator* creator,
                          EnvSerializeInfo* info);
}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_NODE_SERIALIZABLE_H_
