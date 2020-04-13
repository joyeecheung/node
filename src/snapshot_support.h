#ifndef SRC_SNAPSHOT_SUPPORT_H_
#define SRC_SNAPSHOT_SUPPORT_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "v8.h"
#include <map>
#include <ostream>
#include <unordered_map>

namespace node {

class BaseObject;
class Environment;

class SnapshotDataBase {
 public:
  virtual ~SnapshotDataBase() = default;
  static constexpr size_t kEmptyIndex = static_cast<size_t>(-1);

  void add_error(const std::string& error);
  inline const std::vector<std::string>& errors() const;
  inline std::vector<uint8_t> release_storage();

  void PrintErrorsAndAbortIfAny();

 protected:
  explicit inline SnapshotDataBase(std::vector<uint8_t>&& storage);
  SnapshotDataBase() = default;

  bool HasSpace(size_t addition) const;

  std::vector<uint8_t> storage_;

  struct State {
    size_t current_index = 0;
    std::vector<std::string> errors;
    std::vector<std::string> entry_stack;
  };
  State state_;

  static const uint8_t kContextIndependentObjectTag;
  static const uint8_t kObjectTag;

  class SaveStateScope {
   public:
    explicit SaveStateScope(SnapshotDataBase* snapshot_data);
    ~SaveStateScope();

   private:
    SnapshotDataBase* snapshot_data_;
    State state_;
  };
};

class SnapshotCreateData final : public SnapshotDataBase {
 public:
  void StartWriteEntry(const char* name);
  void EndWriteEntry();

  void WriteBool(bool value);
  void WriteInt32(int32_t value);
  void WriteInt64(int64_t value);
  void WriteUint32(uint32_t value);
  void WriteUint64(uint64_t value);
  void WriteIndex(size_t value);
  void WriteString(const char* str, size_t length = static_cast<size_t>(-1));
  void WriteString(const std::string& str);

  template <typename T>
  inline void WriteContextIndependentObject(v8::Local<T> data);
  template <typename T>
  inline void WriteObject(v8::Local<v8::Context> context, v8::Local<T> data);

  inline v8::SnapshotCreator* creator();
  inline v8::Isolate* isolate();

  explicit inline SnapshotCreateData(v8::SnapshotCreator* creator);

 private:
  void WriteTag(uint8_t tag);
  void WriteRawData(const uint8_t* data, size_t length);
  void EnsureSpace(size_t addition);

  v8::SnapshotCreator* creator_;
};

class SnapshotReadData final : public SnapshotDataBase {
 public:
  enum EmptyHandleMode {
    kAllowEmpty,
    kRejectEmpty
  };

  v8::Maybe<std::string> StartReadEntry(const char* expected_name);
  v8::Maybe<bool> EndReadEntry();

  v8::Maybe<bool> ReadBool();
  v8::Maybe<int32_t> ReadInt32();
  v8::Maybe<int64_t> ReadInt64();
  v8::Maybe<uint32_t> ReadUint32();
  v8::Maybe<uint64_t> ReadUint64();
  v8::Maybe<size_t> ReadIndex();
  v8::Maybe<std::string> ReadString();

  template <typename T>
  inline v8::Maybe<v8::Local<T>> ReadContextIndependentObject(
      EmptyHandleMode mode = kRejectEmpty);
  template <typename T>
  inline v8::Maybe<v8::Local<T>> ReadObject(
      v8::Local<v8::Context> context, EmptyHandleMode mode = kRejectEmpty);

  v8::Maybe<bool> Finish();
  void Dump(std::ostream& out);

  inline v8::Isolate* isolate();
  inline void set_isolate(v8::Isolate*);

  explicit inline SnapshotReadData(std::vector<uint8_t>&& storage);

 private:
  bool ReadTag(uint8_t tag);
  v8::Maybe<uint8_t> PeekTag();
  bool ReadRawData(uint8_t* data, size_t length);

  v8::Isolate* isolate_;
};

class Snapshottable {
 public:
  virtual ~Snapshottable() = 0;
  virtual void Serialize(SnapshotCreateData* snapshot_data) const;
};

class ExternalReferences {
 public:
  // Create static instances of this class to register a list of external
  // references for usage in snapshotting. Usually, this includes all C++
  // binding functions. `id` can be any string, as long as it is unique
  // (e.g. the current file name as retrieved by __FILE__).
  template <typename... Args>
  inline ExternalReferences(const char* id, Args*... args);

  // Returns the list of all references collected so far, not yet terminated
  // by kEnd.
  static std::vector<intptr_t> get_list();

  static const intptr_t kEnd;  // The end-of-list marker used by V8, nullptr.

 private:
  void Register(const char* id, ExternalReferences* self);
  static std::map<std::string, ExternalReferences*>* map();
  std::vector<intptr_t> references_;

  void AddPointer(intptr_t ptr);
  inline void HandleArgs();
  template <typename T, typename... Args>
  inline void HandleArgs(T* ptr, Args*... args);
};

// Currently, our Environment contains references to FunctionTemplates and
// ObjectTemplates, which refer back to the Environment instance in order for
// it to be available through Environment::GetCurrent(args).
// V8 does not allow such objects to refer to context-dependent data, and in
// particular, we can no longer use a v8::Object as the data object associated
// with these templates. Right now, the only good way around that seems to be
// using an v8::External instead. However, V8 regards the contents of
// v8::External values as external references, whose memory addresses need to
// be known before creating the Isolate when creating or reading from a
// snapshot. This forces us to allocate the memory for the v8::External target
// in advance. This class holds that memory.
// Overall, this is an awkward situation and we can hopefully get around it
// eventually, in some way, but it probably requires changes to upstream V8.
class ExternalReferencePreAllocations {
 public:
  ExternalReferencePreAllocations();

  void* no_binding_data();
  std::vector<intptr_t> references() const;

 private:
  std::unique_ptr<void, void(*)(void*)> no_binding_data_;
};

// TODO(addaleax): Export this once snapshotting becomes public API in some way.
struct HeapExternalReferences {
  std::unique_ptr<ExternalReferencePreAllocations> allocations;
  std::vector<intptr_t> references;
};
HeapExternalReferences AllocateExternalRerefences();

class BaseObjectDeserializer {
 public:
  typedef BaseObject* (*Callback)(Environment*, SnapshotReadData*);

  BaseObjectDeserializer(const std::string& name, Callback callback);

  static BaseObject* Deserialize(
      const std::string& name,
      Environment* env,
      SnapshotReadData* snapshot_data);

 private:
  static std::map<std::string, Callback>* map();
};

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_SNAPSHOT_SUPPORT_H_
