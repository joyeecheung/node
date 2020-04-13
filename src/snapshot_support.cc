#include "snapshot_support.h"  // NOLINT(build/include_inline)
#include "snapshot_support-inl.h"
#include "debug_utils-inl.h"
#include "json_utils.h"  // EscapeJsonChars
#include "util.h"
#include <cmath>  // std::log10
#include <iomanip>  // std::setw

using v8::Just;
using v8::Maybe;
using v8::Nothing;

namespace node {

Snapshottable::~Snapshottable() {}

void Snapshottable::Serialize(SnapshotCreateData* snapshot_data) const {
  snapshot_data->add_error("Unserializable object encountered");
}

#define SNAPSHOT_TAGS(V)                     \
  V(kEntryStart)                             \
  V(kEntryEnd)                               \
  V(kBool)                                   \
  V(kInt32)                                  \
  V(kInt64)                                  \
  V(kUint32)                                 \
  V(kUint64)                                 \
  V(kIndex)                                  \
  V(kString)                                 \
  V(kContextIndependentObject)               \
  V(kObject)                                 \

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

const uint8_t SnapshotDataBase::kContextIndependentObjectTag =
  kContextIndependentObject;
const uint8_t SnapshotDataBase::kObjectTag = kObject;

SnapshotDataBase::SaveStateScope::SaveStateScope(
    SnapshotDataBase* snapshot_data)
  : snapshot_data_(snapshot_data), state_(snapshot_data->state_) {
}

SnapshotDataBase::SaveStateScope::~SaveStateScope() {
  snapshot_data_->state_ = std::move(state_);
}


bool SnapshotDataBase::HasSpace(size_t addition) const {
  return storage_.size() - state_.current_index >= addition;
}

void SnapshotCreateData::EnsureSpace(size_t addition) {
  if (LIKELY(HasSpace(addition))) return;  // Enough space.
  addition = std::max<size_t>(addition, 4096);
  storage_.resize(storage_.size() + addition);
}

void SnapshotCreateData::WriteRawData(const uint8_t* data, size_t length) {
  EnsureSpace(length);
  memcpy(storage_.data() + state_.current_index, data, length);
  state_.current_index += length;
}

bool SnapshotReadData::ReadRawData(uint8_t* data, size_t length) {
  if (UNLIKELY(!HasSpace(length))) {
    add_error("Unexpected end of input");
    return false;
  }
  memcpy(data, storage_.data() + state_.current_index, length);
  state_.current_index += length;
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

Maybe<uint8_t> SnapshotReadData::PeekTag() {
  SaveStateScope state_scope(this);
  uint8_t tag;
  if (!ReadRawData(&tag, 1)) return Nothing<uint8_t>();
  return Just(tag);
}

void SnapshotCreateData::StartWriteEntry(const char* name) {
  WriteTag(kEntryStart);
  WriteString(name);
  state_.entry_stack.push_back(name);
}

void SnapshotCreateData::EndWriteEntry() {
  if (state_.entry_stack.empty()) {
    add_error("Attempting to end entry on empty stack");
    return;
  }

  state_.entry_stack.pop_back();
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
  state_.entry_stack.push_back(actual);
  return Just(std::move(actual));
}

v8::Maybe<bool> SnapshotReadData::EndReadEntry() {
  if (!ReadTag(kEntryEnd)) return Nothing<bool>();
  if (state_.entry_stack.empty()) {
    add_error("Attempting to end entry on empty stack");
    return Nothing<bool>();
  }
  state_.entry_stack.pop_back();
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
  if (!state_.entry_stack.empty()) {
    add_error("Entries left on snapshot stack");
    return Nothing<bool>();
  }

  if (state_.current_index != storage_.size()) {
    add_error("Unexpected data at end of snapshot");
    return Nothing<bool>();
  }

  storage_.clear();
  storage_.shrink_to_fit();
  state_ = State{};
  return Just(true);
}

void SnapshotDataBase::add_error(const std::string& error) {
  std::string location = "At [";
  location += std::to_string(state_.current_index);
  location += "] ";
  for (const std::string& entry : state_.entry_stack) {
    location += entry;
    location += ':';
  }
  location += " ";
  location += error;
  state_.errors.emplace_back(std::move(location));
}

void SnapshotDataBase::PrintErrorsAndAbortIfAny() {
  if (errors().empty()) return;
  for (const std::string& error : errors())
    fprintf(stderr, "Snapshot error: %s\n", error.c_str());
  fflush(stderr);
  Abort();
}

void SnapshotReadData::Dump(std::ostream& out) {
  SaveStateScope state_scope(this);
  state_ = State{};

  const int index_width = std::log10(storage_.size()) + 1;
  while (state_.current_index < storage_.size() && errors().empty()) {
    uint8_t tag;
    if (!PeekTag().To(&tag)) {
      ReadTag(0);  // PeekTag() failing means EOF, this re-generates that error.
      break;
    }

    out << std::setw(index_width) << state_.current_index << ' ';
    for (size_t i = 0; i < state_.entry_stack.size(); i++) out << "  ";
    switch (tag) {
      case kEntryStart: {
        std::string str;
        if (!StartReadEntry(nullptr).To(&str)) break;
        out << "StartEntry: [" << str << "]\n";
        break;
      }
      case kEntryEnd: {
        if (EndReadEntry().IsNothing()) break;
        out << "EndEntry\n";
        break;
      }
      case kBool: {
        bool value;
        if (!ReadBool().To(&value)) break;
        out << "Bool: " << value << "\n";
        break;
      }
      case kInt32: {
        int32_t value;
        if (!ReadInt32().To(&value)) break;
        out << "Int32: " << value << "\n";
        break;
      }
      case kInt64: {
        int64_t value;
        if (!ReadInt64().To(&value)) break;
        out << "Int64: " << value << "\n";
        break;
      }
      case kUint32: {
        uint32_t value;
        if (!ReadUint32().To(&value)) break;
        out << "Uint32: " << value << "\n";
        break;
      }
      case kUint64: {
        uint64_t value;
        if (!ReadUint64().To(&value)) break;
        out << "Uint64: " << value << "\n";
        break;
      }
      case kString: {
        std::string value;
        if (!ReadString().To(&value)) break;
        out << "String: \"" << EscapeJsonChars(value) << "\"\n";
        break;
      }
      case kContextIndependentObjectTag:
      case kObjectTag:
        CHECK(ReadTag(tag));
        // fall-through
      case kIndex: {
        size_t index;
        if (!ReadIndex().To(&index)) break;
        if (tag == kContextIndependentObjectTag)
          out << "Context-independent object index: ";
        else
          out << "Object index: ";
        if (index == kEmptyIndex)
          out << "(empty)\n";
        else
          out << index << "\n";
        break;
      }
      default: {
        out << TagName(tag) << "\n";
        add_error(SPrintF("Unknown tag %d", tag));
        break;
      }
    }
  }

  if (!errors().empty()) {
    out << "\n" << errors().size() << " errors found:\n";
    for (const std::string& error : errors())
      out << "- " << error << "\n";
  }
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
