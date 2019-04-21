
#include "base_object-inl.h"
#include "debug_utils-inl.h"
#include "node_file.h"
#include "node_serializable.h"
#include "node_v8.h"

namespace node {

using v8::Local;
using v8::Object;
using v8::SnapshotCreator;
using v8::StartupData;
using v8::String;

SerializableObject::SerializableObject(Environment* env,
                                       Local<Object> wrap,
                                       EmbedderObjectType type)
    : BaseObject(env, wrap), type_(type) {
}

Local<String> SerializableObject::GetTypeName() const {
  switch (type_) {
#define V(PropertyName, NativeTypeName)                                        \
  case EmbedderObjectType::k_##PropertyName: {                                 \
    return env()->PropertyName##_string();                                     \
  }
    SERIALIZABLE_OBJECT_TYPES(V)
#undef V
    default: { UNREACHABLE(); }
  }
}

const char* SerializableObject::GetTypeNameChars() const {
  switch (type_) {
#define V(PropertyName, NativeTypeName)                                        \
  case EmbedderObjectType::k_##PropertyName: {                                 \
    return NativeTypeName::type_name.c_str();                                  \
  }
    SERIALIZABLE_OBJECT_TYPES(V)
#undef V
    default: { UNREACHABLE(); }
  }
}

void DeserializeNodeInternalFields(Local<Object> holder,
                                   int index,
                                   StartupData payload,
                                   void* env) {
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "Deserialize internal field %d of %p, size=%d\n",
                     static_cast<int>(index),
                     (*holder),
                     static_cast<int>(payload.raw_size));
  if (payload.raw_size == 0) {
    holder->SetAlignedPointerInInternalField(index, nullptr);
    return;
  }

  // TODO(joyeecheung): here we assume that
  // 1. the holder is a BaseObject
  // 2. the slot is the and BaseObject::kSlot and we are reviving
  //    the BaseObject reference
  // 3. the payload contains a InternalFieldInfo whose type indicates
  //    the type of the BaseObject.
  // Which may be expanded if we want to support non-BaseObject types
  // or types with more slots.
  CHECK_EQ(index, BaseObject::kSlot);
  Environment* env_ptr = static_cast<Environment*>(env);
  const InternalFieldInfo* info =
      reinterpret_cast<const InternalFieldInfo*>(payload.data);

  switch (info->type) {
#define V(PropertyName, NativeTypeName)                                        \
  case EmbedderObjectType::k_##PropertyName: {                                 \
    per_process::Debug(DebugCategory::MKSNAPSHOT,                              \
                       "Object %p is %s\n",                                    \
                       (*holder),                                              \
                       NativeTypeName::type_name.c_str());                     \
    env_ptr->EnqueueDeserializeRequest({NativeTypeName::Deserialize,           \
                                        {env_ptr->isolate(), holder},          \
                                        info->Copy()});                        \
    break;                                                                     \
  }
    SERIALIZABLE_OBJECT_TYPES(V)
#undef V
    default: { UNREACHABLE(); }
  }
}

StartupData SerializeNodeContextInternalFields(Local<Object> holder,
                                               int index,
                                               void* env) {
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "Serialize internal field, index=%d, holder=%p\n",
                     static_cast<int>(index),
                     *holder);
  void* ptr = holder->GetAlignedPointerFromInternalField(index);
  if (ptr == nullptr) {
    return StartupData{nullptr, 0};
  }

  // For now, we just assume that we can only deal with kSlot fields of
  // BaseObjects.
  // TODO(joyeecheung): add more types for other objects with embedder fields.
  CHECK_EQ(index, BaseObject::kSlot);

  SerializableObject* obj = static_cast<SerializableObject*>(ptr);
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "Object %p is %s, ",
                     *holder,
                     obj->GetTypeNameChars());
  InternalFieldInfo* info = obj->Serialize();
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "payload size=%d\n",
                     static_cast<int>(info->length));
  return StartupData{reinterpret_cast<const char*>(info),
                     static_cast<int>(info->length)};
}

void SerializeBindingData(Environment* env,
                          SnapshotCreator* creator,
                          EnvSerializeInfo* info) {
  size_t i = 0;
  env->ForEachBindingData([&](FastStringKey key,
                              BaseObjectPtr<BaseObject> binding) {
    per_process::Debug(DebugCategory::MKSNAPSHOT,
                       "Serialize binding %i, %p, type=%s\n",
                       static_cast<int>(i),
                       *(binding->object()),
                       key.c_str());

    if (key == fs::BindingData::type_name ||
        key == v8_utils::BindingData::type_name) {
      size_t index = creator->AddData(env->context(), binding->object());
      per_process::Debug(DebugCategory::MKSNAPSHOT,
                         "Serialized with index=%d\n",
                         static_cast<int>(index));
      info->bindings.push_back({key.c_str(), i, index});
      SerializableObject* ptr = static_cast<SerializableObject*>(binding.get());
      ptr->PrepareForSerialization(env->context(), creator);
    } else {
      UNREACHABLE();
    }

    i++;
  });
}

}  // namespace node
