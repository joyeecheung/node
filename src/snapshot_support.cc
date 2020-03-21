#include "snapshot_support.h"  // NOLINT(build/include_inline)
#include "snapshot_support-inl.h"
#include "debug_utils-inl.h"
#include "util.h"

using v8::Just;
using v8::Maybe;
using v8::Nothing;

namespace node {

Snapshottable::~Snapshottable() {}

void Snapshottable::Serialize(SnapshotCreateData* snapshot_data) const {
  snapshot_data->add_error("Unserializable object encountered");
}

#define SNAPSHOT_TAGS(V)   \
  V(kEntryStart)           \
  V(kEntryEnd)             \
  V(kBool)                 \
  V(kInt32)                \
  V(kInt64)                \
  V(kUint32)               \
  V(kUint64)               \
  V(kIndex)                \
  V(kString)               \

enum Tag {
#define V(name) name,
  SNAPSHOT_TAGS(V)
#undef V
};

static std::string TagName(int tag) {
#define V(name) if (tag == name) return #name;
  SNAPSHOT_TAGS(V)
#undef V
  return SPrintF("(unknown tag %d)", tag);
}

bool SnapshotDataBase::HasSpace(size_t addition) const {
  return storage_.size() - current_index_ >= addition;
}

void SnapshotCreateData::EnsureSpace(size_t addition) {
  if (LIKELY(HasSpace(addition))) return;  // Enough space.
  addition = std::max<size_t>(addition, 4096);
  storage_.resize(storage_.size() + addition);
}

void SnapshotCreateData::WriteRawData(const uint8_t* data, size_t length) {
  EnsureSpace(length);
  memcpy(storage_.data() + current_index_, data, length);
  current_index_ += length;
}

bool SnapshotReadData::ReadRawData(uint8_t* data, size_t length) {
  if (UNLIKELY(!HasSpace(length))) {
    add_error("Unexpected end of input");
    return false;
  }
  memcpy(data, storage_.data() + current_index_, length);
  current_index_ += length;
  return true;
}

void SnapshotCreateData::WriteTag(uint8_t tag) {
  WriteRawData(&tag, 1);
}

bool SnapshotReadData::ReadTag(uint8_t expected) {
  uint8_t actual;
  if (!ReadRawData(&actual, 1)) return false;
  if (actual != expected) {
    add_error(SPrintF("Unexpected tag %s (expected %s)",
                      TagName(actual), TagName(expected)));
    return false;
  }
  return true;
}

void SnapshotCreateData::StartWriteEntry(const char* name) {
  WriteTag(kEntryStart);
  WriteString(name);
  entry_stack_.push_back(name);
}

void SnapshotCreateData::EndWriteEntry() {
  entry_stack_.pop_back();
  WriteTag(kEntryEnd);
}

void SnapshotCreateData::WriteBool(bool value) {
  WriteTag(kBool);
  uint8_t data = value ? 1 : 0;
  WriteRawData(&data, 1);
}

void SnapshotCreateData::WriteInt32(int32_t value) {
  WriteTag(kInt32);
  WriteRawData(reinterpret_cast<const uint8_t*>(&value), sizeof(value));
}

void SnapshotCreateData::WriteInt64(int64_t value) {
  WriteTag(kInt64);
  WriteRawData(reinterpret_cast<const uint8_t*>(&value), sizeof(value));
}

void SnapshotCreateData::WriteUint32(uint32_t value) {
  WriteTag(kUint32);
  WriteRawData(reinterpret_cast<const uint8_t*>(&value), sizeof(value));
}

void SnapshotCreateData::WriteUint64(uint64_t value) {
  WriteTag(kUint64);
  WriteRawData(reinterpret_cast<const uint8_t*>(&value), sizeof(value));
}

void SnapshotCreateData::WriteIndex(size_t value) {
  WriteTag(kIndex);
  WriteRawData(reinterpret_cast<const uint8_t*>(&value), sizeof(value));
}

void SnapshotCreateData::WriteString(const char* str, size_t length) {
  WriteTag(kString);
  if (length == static_cast<size_t>(-1)) length = strlen(str);
  WriteUint64(length);
  WriteRawData(reinterpret_cast<const uint8_t*>(str), length);
}

void SnapshotCreateData::WriteString(const std::string& str) {
  WriteString(str.c_str(), str.size());
}

v8::Maybe<std::string> SnapshotReadData::StartReadEntry(const char* expected) {
  if (!ReadTag(kEntryStart)) return Nothing<std::string>();
  std::string actual;
  if (!ReadString().To(&actual)) return Nothing<std::string>();
  if (expected != nullptr && actual != expected) {
    add_error(SPrintF("Unexpected entry %s (expected %s)", actual, expected));
    return Nothing<std::string>();
  }
  entry_stack_.push_back(actual);
  return Just(std::move(actual));
}

v8::Maybe<bool> SnapshotReadData::EndReadEntry() {
  if (!ReadTag(kEntryEnd)) return Nothing<bool>();
  entry_stack_.pop_back();
  return Just(true);
}

v8::Maybe<bool> SnapshotReadData::ReadBool() {
  if (!ReadTag(kBool)) return Nothing<bool>();
  uint8_t value;
  if (!ReadRawData(&value, 1)) return Nothing<bool>();
  return Just(static_cast<bool>(value));
}

v8::Maybe<int32_t> SnapshotReadData::ReadInt32() {
  if (!ReadTag(kInt32)) return Nothing<int32_t>();
  int32_t value;
  if (!ReadRawData(reinterpret_cast<uint8_t*>(&value), sizeof(value)))
    return Nothing<int32_t>();
  return Just(value);
}

v8::Maybe<int64_t> SnapshotReadData::ReadInt64() {
  if (!ReadTag(kInt64)) return Nothing<int64_t>();
  int64_t value;
  if (!ReadRawData(reinterpret_cast<uint8_t*>(&value), sizeof(value)))
    return Nothing<int64_t>();
  return Just(value);
}

v8::Maybe<uint32_t> SnapshotReadData::ReadUint32() {
  if (!ReadTag(kUint32)) return Nothing<uint32_t>();
  uint32_t value;
  if (!ReadRawData(reinterpret_cast<uint8_t*>(&value), sizeof(value)))
    return Nothing<uint32_t>();
  return Just(static_cast<uint32_t>(value));
}

v8::Maybe<uint64_t> SnapshotReadData::ReadUint64() {
  if (!ReadTag(kUint64)) return Nothing<uint64_t>();
  uint64_t value;
  if (!ReadRawData(reinterpret_cast<uint8_t*>(&value), sizeof(value)))
    return Nothing<uint64_t>();
  return Just(value);
}

v8::Maybe<size_t> SnapshotReadData::ReadIndex() {
  if (!ReadTag(kIndex)) return Nothing<size_t>();
  size_t value;
  if (!ReadRawData(reinterpret_cast<uint8_t*>(&value), sizeof(value)))
    return Nothing<size_t>();
  return Just(value);
}

v8::Maybe<std::string> SnapshotReadData::ReadString() {
  if (!ReadTag(kString)) return Nothing<std::string>();
  uint64_t size;
  if (!ReadUint64().To(&size)) return Nothing<std::string>();
  std::string str(size, '\0');
  if (!ReadRawData(reinterpret_cast<uint8_t*>(&str[0]), size))
    return Nothing<std::string>();
  return Just(std::move(str));
}

v8::Maybe<bool> SnapshotReadData::Finish() {
  if (!entry_stack_.empty()) {
    add_error("Entries left on snapshot stack");
    return Nothing<bool>();
  }

  if (current_index_ != storage_.size()) {
    add_error("Unexpected data at end of snapshot");
    return Nothing<bool>();
  }

  storage_.clear();
  storage_.shrink_to_fit();
  current_index_ = 0;
  return Just(true);
}

void SnapshotDataBase::add_error(const std::string& error) {
  std::string location = "At ";
  for (const std::string& entry : entry_stack_) {
    location += entry;
    location += ':';
  }
  errors_.push_back(location + " " + error);
}

void SnapshotDataBase::PrintErrorsAndAbortIfAny() {
  if (errors_.empty()) return;
  for (const std::string& error : errors_)
    fprintf(stderr, "Snapshot error: %s\n", error.c_str());
  fflush(stderr);
  Abort();
}

void ExternalReferences::AddPointer(intptr_t ptr) {
  DCHECK_NE(ptr, kEnd);
  references_.push_back(ptr);
}

std::map<std::string, ExternalReferences*>* ExternalReferences::map() {
  static std::map<std::string, ExternalReferences*> map_;
  return &map_;
}

std::vector<intptr_t> ExternalReferences::get_list() {
  static std::vector<intptr_t> list;
  if (list.empty()) {
    for (const auto& entry : *map()) {
      std::vector<intptr_t>* source = &entry.second->references_;
      list.insert(list.end(), source->begin(), source->end());
      source->clear();
      source->shrink_to_fit();
    }
  }
  return list;
}

void ExternalReferences::Register(const char* id, ExternalReferences* self) {
  auto result = map()->insert({id, this});
  CHECK(result.second);
}

const intptr_t ExternalReferences::kEnd = reinterpret_cast<intptr_t>(nullptr);

BaseObjectDeserializer::BaseObjectDeserializer(
    const std::string& name, Callback callback) {
  auto result = map()->insert({name, callback});
  CHECK(result.second);
}

BaseObject* BaseObjectDeserializer::Deserialize(
    const std::string& name,
    Environment* env,
    SnapshotReadData* snapshot_data) {
  Callback callback = (*map())[name];
  if (callback == nullptr) {
    snapshot_data->add_error(SPrintF("Unknown BaseObject type %s", name));
    return nullptr;
  }
  return callback(env, snapshot_data);
}

std::map<std::string, BaseObjectDeserializer::Callback>*
BaseObjectDeserializer::map() {
  static std::map<std::string, Callback> map_;
  return &map_;
}

}  // namespace node
