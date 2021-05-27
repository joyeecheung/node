
#include "node_snapshotable.h"
#include <iostream>
#include <sstream>
#include "base_object-inl.h"
#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_blob.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_file.h"
#include "node_internals.h"
#include "node_main_instance.h"
#include "node_metadata.h"
#include "node_native_module_env.h"
#include "node_process.h"
#include "node_snapshot_builder.h"
#include "node_v8.h"
#include "node_v8_platform-inl.h"

#if HAVE_INSPECTOR
#include "inspector/worker_inspector.h"  // ParentInspectorHandle
#endif

namespace node {

using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::ScriptCompiler;
using v8::ScriptOrigin;
using v8::SnapshotCreator;
using v8::StartupData;
using v8::String;
using v8::TryCatch;
using v8::Value;

const uint64_t SnapshotData::kMagic;

std::ostream& operator<<(std::ostream& output,
                         const std::vector<native_module::CodeCacheInfo>& vec) {
  output << "{\n";
  for (const auto& info : vec) {
    output << "<native_module::CodeCacheInfo id=" << info.id
           << ", size=" << info.data.size() << ">";
  }
  output << "}\n";
  return output;
}

std::ostream& operator<<(std::ostream& output,
                         const std::vector<uint8_t>& vec) {
  output << "{\n";
  for (const auto& i : vec) {
    output << i << ",";
  }
  output << "}";
  return output;
}

class FileIO {
 public:
  explicit FileIO(FILE* file)
      : f(file),
        is_debug(per_process::enabled_debug_list.enabled(
            DebugCategory::MKSNAPSHOT)) {}

  template <typename... Args>
  void Debug(const char* format, Args&&... args) const {
    per_process::Debug(
        DebugCategory::MKSNAPSHOT, format, std::forward<Args>(args)...);
  }

  template <typename T>
  std::string ToStr(const T& arg) const {
    std::stringstream ss;
    ss << arg;
    return ss.str();
  }
  template <typename T>
  const char* GetName() const {
    return "";
  }
  FILE* f = nullptr;
  bool is_debug = false;
};

template <>
const char* FileIO::GetName<native_module::CodeCacheInfo>() const {
  return "native_module::CodeCacheInfo";
}

template <>
const char* FileIO::GetName<int>() const {
  return "int";
}

template <>
const char* FileIO::GetName<size_t>() const {
  return "size_t";
}
template <>
const char* FileIO::GetName<char>() const {
  return "char";
}
class FileReader : public FileIO {
 public:
  explicit FileReader(FILE* file) : FileIO(file) {}
  ~FileReader() {}

  template <typename T>
  void Read(T* out, size_t count) {
    if (is_debug) {
      Debug("Read<%s>()(%d-byte), count=%d: ", GetName<T>(), sizeof(T), count);
    }

    size_t r = fread(out, sizeof(T), count, f);

    if (is_debug) {
      std::string str = ToStr(*out);
      Debug("%s, read %d bytes\n", str.c_str(), r);
    }
  }

  template <typename T>
  T Read() {
    T result;
    Read(&result, 1);
    return result;
  }

  template <typename T>
  std::vector<T> ReadVector(size_t count) {
    if (is_debug) {
      Debug("ReadVector<%s>()(%d-byte), count=%d: ",
            GetName<T>(),
            sizeof(T),
            count);
    }

    std::vector<T> result;
    result.reserve(count);
    for (size_t i = 0; i < count; ++i) {
      if (is_debug && sizeof(T) > 8) {
        Debug("[%d] ", i);
      }
      is_debug = false;
      result.push_back(Read<T>());
      is_debug = true;
    }

    return result;
  }

  template <typename T>
  std::vector<T> ReadVector() {
    size_t count = Read<size_t>();
    return ReadVector<T>(count);
  }

  std::string ReadString(size_t length) {
    if (is_debug) {
      Debug("ReadString(), length=%d: ", length);
    }

    MallocedBuffer<char> buf(length + 1);
    size_t r = fread(buf.data, 1, length + 1, f);
    std::string result(buf.data, length);  // This creates a copy of buf.data.

    if (is_debug) {
      Debug("%s, read %d bytes\n", result.c_str(), r);
    }

    return result;
  }

  std::string ReadString() {
    size_t length = Read<size_t>();
    return ReadString(length);
  }
};

class FileWriter : public FileIO {
 public:
  explicit FileWriter(FILE* file) : FileIO(file) {}
  ~FileWriter() {}

  template <typename T>
  size_t Write(const T& data) {
    return Write(&data, 1);
  }

  template <typename T>
  size_t Write(const T* data, size_t count) {
    if (is_debug) {
      std::string str = ToStr(*data);
      Debug("Write<%s>() (%d-byte), count=%d: %s",
            GetName<T>(),
            sizeof(T),
            count,
            str.c_str());
    }

    size_t r = fwrite(data, sizeof(T), count, f);

    if (is_debug) {
      Debug(", wrote %d bytes\n", r);
    }
    return r;
  }

  template <typename T>
  size_t WriteVector(const std::vector<T>& data) {
    if (is_debug) {
      std::string str = ToStr(data);
      Debug("WriteVector<%s>() (%d-byte), count=%d: %s\n",
            GetName<T>(),
            sizeof(T),
            data.size(),
            str.c_str());
    }

    size_t count = data.size();
    size_t written_total = Write(count);
    for (size_t i = 0; i < data.size(); ++i) {
      if (is_debug && sizeof(T) > 8) {
        Debug("[%d] ", i);
      }
      is_debug = false;
      written_total += Write<T>(data[i]);
      is_debug = true;
    }

    if (is_debug) {
      Debug("WriteVector<%s>() wrote %d bytes\n", GetName<T>(), written_total);
    }

    return written_total;
  }

  size_t WriteString(const std::string& data) {
    if (is_debug) {
      std::string str = ToStr(data);
      Debug("WriteString(), length=%d: %s\n", data.size(), data.c_str());
    }

    Write<size_t>(data.size());
    size_t r = fwrite(data.c_str(), 1, data.size() + 1, f);

    if (is_debug) {
      Debug("WriteString() wrote %d bytes\n", r);
    }

    return r;
  }
};

template <>
std::string FileReader::Read() {
  return ReadString();
}
template <>
size_t FileWriter::Write(const std::string& data) {
  return WriteString(data);
}

template <>
v8::StartupData FileReader::Read() {
  Debug("Read<v8::StartupData>() ");

  int length = Read<int>();
  std::unique_ptr<char> buf = std::unique_ptr<char>(new char[length]);
  Read<char>(buf.get(), length);

  Debug("size=%d\n", length);

  return v8::StartupData{buf.release(), length};
}

template <>
size_t FileWriter::Write(const v8::StartupData& data) {
  Debug("\nWrite<v8::StartupData>() size=%d\n", data.raw_size);

  int count = data.raw_size;
  size_t written_total = Write<int>(count);
  written_total += Write<char>(data.data, static_cast<size_t>(count));

  Debug("Write<v8::StartupData>() wrote %d bytes\n\n", written_total);
  return written_total;
}

template <>
native_module::CodeCacheInfo FileReader::Read() {
  Debug("Read<native_module::CodeCacheInfo>() ");

  native_module::CodeCacheInfo result{ReadString(), ReadVector<uint8_t>()};
  Debug("id = %s, size=%d\n", result.id.c_str(), result.data.size());

  return result;
}

template <>
size_t FileWriter::Write(const native_module::CodeCacheInfo& data) {
  Debug("\nWrite<native_module::CodeCacheInfo>() id = %s"
        "size=%d\n",
        data.id.c_str(),
        data.data.size());

  size_t written_total = WriteString(data.id);
  written_total += WriteVector<uint8_t>(data.data);

  Debug("Write<native_module::CodeCacheInfo>() wrote %d bytes\n\n",
        written_total);
  return written_total;
}

template <>
PropInfo FileReader::Read() {
  Debug("Read<PropInfo>() ");

  PropInfo result;
  result.name = ReadString();
  result.id = Read<size_t>();
  result.index = Read<size_t>();

  if (is_debug) {
    std::string str = ToStr(result);
    Debug(" %s", str.c_str());
  }

  return result;
}

template <>
size_t FileWriter::Write(const PropInfo& data) {
  if (is_debug) {
    std::string str = ToStr(data);
    Debug("Write<PropInfo>() %s ", str.c_str());
  }

  size_t written_total = WriteString(data.name);
  written_total += Write<size_t>(data.id);
  written_total += Write<size_t>(data.index);

  Debug("wrote %d bytes\n", written_total);
  return written_total;
}

template <>
AsyncHooks::SerializeInfo FileReader::Read() {
  Debug("Read<AsyncHooks::SerializeInfo>() ");

  AsyncHooks::SerializeInfo result;
  result.async_ids_stack = Read<size_t>();
  result.fields = Read<size_t>();
  result.async_id_fields = Read<size_t>();
  result.js_execution_async_resources = Read<size_t>();
  result.native_execution_async_resources = ReadVector<size_t>();

  if (is_debug) {
    std::string str = ToStr(result);
    Debug(" %s", str.c_str());
  }

  return result;
}
template <>
size_t FileWriter::Write(const AsyncHooks::SerializeInfo& data) {
  if (is_debug) {
    std::string str = ToStr(data);
    Debug("Write<AsyncHooks::SerializeInfo>() %s ", str.c_str());
  }

  size_t written_total = Write<size_t>(data.async_ids_stack);
  written_total += Write<size_t>(data.fields);
  written_total += Write<size_t>(data.async_id_fields);
  written_total += Write<size_t>(data.js_execution_async_resources);
  written_total += WriteVector<size_t>(data.native_execution_async_resources);

  Debug("wrote %d bytes\n", written_total);
  return written_total;
}

template <>
TickInfo::SerializeInfo FileReader::Read() {
  Debug("Read<TickInfo::SerializeInfo>() ");

  TickInfo::SerializeInfo result;
  result.fields = Read<size_t>();

  if (is_debug) {
    std::string str = ToStr(result);
    Debug(" %s", str.c_str());
  }

  return result;
}

template <>
size_t FileWriter::Write(const TickInfo::SerializeInfo& data) {
  if (is_debug) {
    std::string str = ToStr(data);
    Debug("Write<TickInfo::SerializeInfo>() %s ", str.c_str());
  }

  size_t written_total = Write<size_t>(data.fields);

  Debug("wrote %d bytes\n", written_total);
  return written_total;
}

template <>
ImmediateInfo::SerializeInfo FileReader::Read() {
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "Read ImmediateInfo::SerializeInfo\n");
  ImmediateInfo::SerializeInfo result;
  result.fields = Read<size_t>();
  return result;
}

template <>
size_t FileWriter::Write(const ImmediateInfo::SerializeInfo& data) {
  if (is_debug) {
    std::string str = ToStr(data);
    Debug("Write<ImmeidateInfo::SerializeInfo>() %s ", str.c_str());
  }

  size_t written_total = Write<size_t>(data.fields);

  Debug("wrote %d bytes\n", written_total);
  return written_total;
}

template <>
performance::PerformanceState::SerializeInfo FileReader::Read() {
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "Read PerformanceState::SerializeInfo\n");
  performance::PerformanceState::SerializeInfo result;
  result.root = Read<size_t>();
  result.milestones = Read<size_t>();
  result.observers = Read<size_t>();
  return result;
}

template <>
size_t FileWriter::Write(
    const performance::PerformanceState::SerializeInfo& data) {
  if (is_debug) {
    std::string str = ToStr(data);
    Debug("Write<PerformanceState::SerializeInfo>() %s", str.c_str());
  }

  size_t written_total = Write<size_t>(data.root);
  written_total += Write<size_t>(data.milestones);
  written_total += Write<size_t>(data.observers);

  Debug("wrote %d bytes\n", written_total);
  return written_total;
}

template <>
EnvSerializeInfo FileReader::Read() {
  per_process::Debug(DebugCategory::MKSNAPSHOT, "Read EnvSerializeInfo\n");
  EnvSerializeInfo result;
  result.bindings = ReadVector<PropInfo>();
  result.native_modules = ReadVector<std::string>();

  result.async_hooks = Read<AsyncHooks::SerializeInfo>();
  result.tick_info = Read<TickInfo::SerializeInfo>();
  result.immediate_info = Read<ImmediateInfo::SerializeInfo>();
  result.performance_state =
      Read<performance::PerformanceState::SerializeInfo>();

  result.stream_base_state = Read<size_t>();
  result.should_abort_on_uncaught_toggle = Read<size_t>();

  result.persistent_templates = ReadVector<PropInfo>();
  result.persistent_values = ReadVector<PropInfo>();

  result.context = Read<size_t>();
  return result;
}

template <>
size_t FileWriter::Write(const EnvSerializeInfo& data) {
  Debug("\nWrite<EnvSerializeInfo>()\n");

  size_t written_total = WriteVector<PropInfo>(data.bindings);
  written_total += WriteVector<std::string>(data.native_modules);

  written_total += Write<AsyncHooks::SerializeInfo>(data.async_hooks);
  written_total += Write<TickInfo::SerializeInfo>(data.tick_info);
  written_total += Write<ImmediateInfo::SerializeInfo>(data.immediate_info);
  written_total += Write<performance::PerformanceState::SerializeInfo>(
      data.performance_state);

  written_total += Write<size_t>(data.stream_base_state);
  written_total += Write<size_t>(data.should_abort_on_uncaught_toggle);

  written_total += WriteVector<PropInfo>(data.persistent_templates);
  written_total += WriteVector<PropInfo>(data.persistent_values);

  written_total += Write<size_t>(data.context);

  Debug("wrote %d bytes\n", written_total);
  return written_total;
}

void SnapshotData::ToBlob(FILE* out) const {
  FileWriter w(out);
  w.Debug("SnapshotData::ToBlob()\n");

  // Metadata
  w.Debug("Write magic %" PRIx64 "\n", kMagic);
  w.Write<uint64_t>(kMagic);
  w.Debug("Write version %s\n", NODE_VERSION);
  w.WriteString(NODE_VERSION);
  w.Debug("Write arch %s\n", NODE_ARCH);
  w.WriteString(NODE_ARCH);

  w.Write<v8::StartupData>(v8_snapshot_blob_data);
  w.Debug("Write isolate_data_indices");
  w.WriteVector<size_t>(isolate_data_indices);
  w.Write<EnvSerializeInfo>(env_info);
  w.WriteVector<native_module::CodeCacheInfo>(code_cache);
}

void SnapshotData::FromBlob(SnapshotData* out, FILE* in) {
  FileReader r(in);
  r.Debug("SnapshotData::FromBlob()\n");

  // Metadata
  uint64_t magic = r.Read<uint64_t>();
  r.Debug("Read magic %" PRIx64 "\n", magic);
  CHECK_EQ(magic, kMagic);
  std::string version = r.ReadString();
  r.Debug("Read version %s\n", version.c_str());
  CHECK_EQ(version, NODE_VERSION);
  std::string arch = r.ReadString();
  r.Debug("Read arch %s\n", arch.c_str());
  CHECK_EQ(arch, NODE_ARCH);

  out->v8_snapshot_blob_data = r.Read<v8::StartupData>();
  out->isolate_data_indices = r.ReadVector<size_t>();
  out->env_info = r.Read<EnvSerializeInfo>();
  out->code_cache = r.ReadVector<native_module::CodeCacheInfo>();
}

std::unique_ptr<SnapshotData> SnapshotData::New() {
  std::unique_ptr<SnapshotData> result = std::make_unique<SnapshotData>();
  result->data_ownership = DataOwnership::kOwned;
  result->v8_snapshot_blob_data.data = nullptr;
  return result;
}

SnapshotData::~SnapshotData() {
  if (data_ownership == DataOwnership::kOwned &&
      v8_snapshot_blob_data.data != nullptr) {
    delete[] v8_snapshot_blob_data.data;
  }
}

template <typename T>
void WriteVector(std::ostream* ss, const T* vec, size_t size) {
  for (size_t i = 0; i < size; i++) {
    *ss << std::to_string(vec[i]) << (i == size - 1 ? '\n' : ',');
  }
}

static std::string GetCodeCacheDefName(const std::string& id) {
  char buf[64] = {0};
  size_t size = id.size();
  CHECK_LT(size, sizeof(buf));
  for (size_t i = 0; i < size; ++i) {
    char ch = id[i];
    buf[i] = (ch == '-' || ch == '/') ? '_' : ch;
  }
  return std::string(buf) + std::string("_cache_data");
}

static std::string FormatSize(size_t size) {
  char buf[64] = {0};
  if (size < 1024) {
    snprintf(buf, sizeof(buf), "%.2fB", static_cast<double>(size));
  } else if (size < 1024 * 1024) {
    snprintf(buf, sizeof(buf), "%.2fKB", static_cast<double>(size / 1024));
  } else {
    snprintf(
        buf, sizeof(buf), "%.2fMB", static_cast<double>(size / 1024 / 1024));
  }
  return buf;
}

static void WriteStaticCodeCacheData(std::ostream* ss,
                                     const native_module::CodeCacheInfo& info) {
  *ss << "static const uint8_t " << GetCodeCacheDefName(info.id) << "[] = {\n";
  WriteVector(ss, info.data.data(), info.data.size());
  *ss << "};";
}

static void WriteCodeCacheInitializer(std::ostream* ss, const std::string& id) {
  std::string def_name = GetCodeCacheDefName(id);
  *ss << "    { \"" << id << "\",\n";
  *ss << "      {" << def_name << ",\n";
  *ss << "       " << def_name << " + arraysize(" << def_name << "),\n";
  *ss << "      }\n";
  *ss << "    },\n";
}

void FormatBlob(std::ostream& ss, SnapshotData* data) {
  ss << R"(#include <cstddef>
#include "env.h"
#include "node_snapshot_builder.h"
#include "v8.h"

// This file is generated by tools/snapshot. Do not edit.

namespace node {

static const char v8_snapshot_blob_data[] = {
)";
  WriteVector(&ss,
              data->v8_snapshot_blob_data.data,
              data->v8_snapshot_blob_data.raw_size);
  ss << R"(};

static const int v8_snapshot_blob_size = )"
     << data->v8_snapshot_blob_data.raw_size << ";";

  // Windows can't deal with too many large vector initializers.
  // Store the data into static arrays first.
  for (const auto& item : data->code_cache) {
    WriteStaticCodeCacheData(&ss, item);
  }

  ss << R"(SnapshotData snapshot_data {
  // -- data_ownership begins --
  SnapshotData::DataOwnership::kNotOwned,
  // -- data_ownership ends --
  // -- v8_snapshot_blob_data begins --
  { v8_snapshot_blob_data, v8_snapshot_blob_size },
  // -- v8_snapshot_blob_data ends --
  // -- isolate_data_indices begins --
  {
)";
  WriteVector(&ss,
              data->isolate_data_indices.data(),
              data->isolate_data_indices.size());
  ss << R"(},
  // -- isolate_data_indices ends --
  // -- env_info begins --
)" << data->env_info
     << R"(
  // -- env_info ends --
  ,
  // -- code_cache begins --
  {)";
  for (const auto& item : data->code_cache) {
    WriteCodeCacheInitializer(&ss, item.id);
  }
  ss << R"(
  }
  // -- code_cache ends --
};

const SnapshotData* SnapshotBuilder::GetEmbeddedSnapshotData() {
  Mutex::ScopedLock lock(snapshot_data_mutex_);
  return &snapshot_data;
}
}  // namespace node
)";
}

Mutex SnapshotBuilder::snapshot_data_mutex_;

const std::vector<intptr_t>& SnapshotBuilder::CollectExternalReferences() {
  static auto registry = std::make_unique<ExternalReferenceRegistry>();
  return registry->external_references();
}

void SnapshotBuilder::InitializeIsolateParams(const SnapshotData* data,
                                              Isolate::CreateParams* params) {
  params->external_references = CollectExternalReferences().data();
  params->snapshot_blob =
      const_cast<v8::StartupData*>(&(data->v8_snapshot_blob_data));
}

constexpr int INTERNAL_ERROR = 12;

int SnapshotBuilder::Generate(SnapshotData* out,
                              const std::vector<std::string> args,
                              const std::vector<std::string> exec_args) {
  const std::vector<intptr_t>& external_references =
      CollectExternalReferences();
  Isolate* isolate = Isolate::Allocate();
  // Must be done before the SnapshotCreator creation so  that the
  // memory reducer can be initialized.
  per_process::v8_platform.Platform()->RegisterIsolate(isolate,
                                                       uv_default_loop());

  SnapshotCreator creator(isolate, external_references.data());

  isolate->SetCaptureStackTraceForUncaughtExceptions(
      true, 10, v8::StackTrace::StackTraceOptions::kDetailed);

  Environment* env = nullptr;
  std::unique_ptr<NodeMainInstance> main_instance =
      NodeMainInstance::Create(isolate,
                               uv_default_loop(),
                               per_process::v8_platform.Platform(),
                               args,
                               exec_args);

  // The cleanups should be done in case of an early exit due to errors.
  auto cleanup = OnScopeLeave([&]() {
    // Must be done while the snapshot creator isolate is entered i.e. the
    // creator is still alive. The snapshot creator destructor will destroy
    // the isolate.
    if (env != nullptr) {
      FreeEnvironment(env);
    }
    main_instance->Dispose();
    per_process::v8_platform.Platform()->UnregisterIsolate(isolate);
  });

  {
    HandleScope scope(isolate);
    TryCatch bootstrapCatch(isolate);

    auto print_Exception = OnScopeLeave([&]() {
      if (bootstrapCatch.HasCaught()) {
        PrintCaughtException(
            isolate, isolate->GetCurrentContext(), bootstrapCatch);
      }
    });

    out->isolate_data_indices =
        main_instance->isolate_data()->Serialize(&creator);

    // The default context with only things created by V8.
    Local<Context> default_context = Context::New(isolate);

    // The Node.js-specific context with primodials, can be used by workers
    // TODO(joyeecheung): investigate if this can be used by vm contexts
    // without breaking compatibility.
    Local<Context> base_context = NewContext(isolate);
    if (base_context.IsEmpty()) {
      return INTERNAL_ERROR;
    }

    Local<Context> main_context = NewContext(isolate);
    if (main_context.IsEmpty()) {
      return INTERNAL_ERROR;
    }
    // Initialize the main instance context.
    {
      Context::Scope context_scope(main_context);

      // Create the environment.
      env = new Environment(main_instance->isolate_data(),
                            main_context,
                            args,
                            exec_args,
                            nullptr,
                            node::EnvironmentFlags::kDefaultFlags,
                            {});

      // Run scripts in lib/internal/bootstrap/
      if (env->RunBootstrapping().IsEmpty()) {
        return INTERNAL_ERROR;
      }
      // If --build-snapshot is true, lib/internal/main/mksnapshot.js would be
      // loaded via LoadEnvironment() to execute process.argv[1] as the entry
      // point (we currently only support this kind of entry point, but we
      // could also explore snapshotting other kinds of execution modes
      // in the future).
      if (per_process::cli_options->build_snapshot) {
#if HAVE_INSPECTOR
        // TODO(joyeecheung): move this before RunBootstrapping().
        env->InitializeInspector({});
#endif
        if (LoadEnvironment(env, StartExecutionCallback{}).IsEmpty()) {
          return 1;
        }
        // FIXME(joyeecheung): right now running the loop in the snapshot
        // builder seems to introduces inconsistencies in JS land that need to
        // be synchronized again after snapshot restoration.
        int exit_code = SpinEventLoop(env).FromMaybe(1);
        if (exit_code != 0) {
          return exit_code;
        }
      }

      if (per_process::enabled_debug_list.enabled(DebugCategory::MKSNAPSHOT)) {
        env->PrintAllBaseObjects();
        printf("Environment = %p\n", env);
      }

      // Serialize the native states
      out->env_info = env->Serialize(&creator);

#ifdef NODE_USE_NODE_CODE_CACHE
      // Regenerate all the code cache.
      if (!native_module::NativeModuleEnv::CompileAllModules(main_context)) {
        return INTERNAL_ERROR;
      }
      native_module::NativeModuleEnv::CopyCodeCache(&(out->code_cache));
      for (const auto& item : out->code_cache) {
        std::string size_str = FormatSize(item.data.size());
        per_process::Debug(DebugCategory::MKSNAPSHOT,
                           "Generated code cache for %d: %s\n",
                           item.id.c_str(),
                           size_str.c_str());
      }
#endif
    }

    // Global handles to the contexts can't be disposed before the
    // blob is created. So initialize all the contexts before adding them.
    // TODO(joyeecheung): figure out how to remove this restriction.
    creator.SetDefaultContext(default_context);
    size_t index = creator.AddContext(base_context);
    CHECK_EQ(index, SnapshotData::kNodeBaseContextIndex);
    index = creator.AddContext(main_context,
                               {SerializeNodeContextInternalFields, env});
    CHECK_EQ(index, SnapshotData::kNodeMainContextIndex);
  }

  // Must be out of HandleScope
  out->v8_snapshot_blob_data =
      creator.CreateBlob(SnapshotCreator::FunctionCodeHandling::kClear);

  // We must be able to rehash the blob when we restore it or otherwise
  // the hash seed would be fixed by V8, introducing a vulnerability.
  if (!out->v8_snapshot_blob_data.CanBeRehashed()) {
    return INTERNAL_ERROR;
  }

  // We cannot resurrect the handles from the snapshot, so make sure that
  // no handles are left open in the environment after the blob is created
  // (which should trigger a GC and close all handles that can be closed).
  bool queues_are_empty =
      env->req_wrap_queue()->IsEmpty() && env->handle_wrap_queue()->IsEmpty();
  if (!queues_are_empty ||
      per_process::enabled_debug_list.enabled(DebugCategory::MKSNAPSHOT)) {
    PrintLibuvHandleInformation(env->event_loop(), stderr);
  }
  if (!queues_are_empty) {
    return INTERNAL_ERROR;
  }
  return 0;
}

int SnapshotBuilder::Generate(std::ostream& out,
                              const std::vector<std::string> args,
                              const std::vector<std::string> exec_args) {
  std::unique_ptr<SnapshotData> data = SnapshotData::New();
  int exit_code = Generate(data.get(), args, exec_args);
  if (exit_code != 0) {
    return exit_code;
  }
  FormatBlob(out, data.get());
  return exit_code;
}

SnapshotableObject::SnapshotableObject(Environment* env,
                                       Local<Object> wrap,
                                       EmbedderObjectType type)
    : BaseObject(env, wrap), type_(type) {
}

const char* SnapshotableObject::GetTypeNameChars() const {
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

bool IsSnapshotableType(FastStringKey key) {
#define V(PropertyName, NativeTypeName)                                        \
  if (key == NativeTypeName::type_name) {                                      \
    return true;                                                               \
  }
  SERIALIZABLE_OBJECT_TYPES(V)
#undef V

  return false;
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
    env_ptr->EnqueueDeserializeRequest(                                        \
        NativeTypeName::Deserialize, holder, index, info->Copy());             \
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
  void* ptr = holder->GetAlignedPointerFromInternalField(BaseObject::kSlot);
  if (ptr == nullptr) {
    return StartupData{nullptr, 0};
  }

  DCHECK(static_cast<BaseObject*>(ptr)->is_snapshotable());
  SnapshotableObject* obj = static_cast<SnapshotableObject*>(ptr);
  per_process::Debug(DebugCategory::MKSNAPSHOT,
                     "Object %p is %s, ",
                     *holder,
                     obj->GetTypeNameChars());
  InternalFieldInfo* info = obj->Serialize(index);
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

    if (IsSnapshotableType(key)) {
      size_t index = creator->AddData(env->context(), binding->object());
      per_process::Debug(DebugCategory::MKSNAPSHOT,
                         "Serialized with index=%d\n",
                         static_cast<int>(index));
      info->bindings.push_back({key.c_str(), i, index});
      SnapshotableObject* ptr = static_cast<SnapshotableObject*>(binding.get());
      ptr->PrepareForSerialization(env->context(), creator);
    } else {
      UNREACHABLE();
    }

    i++;
  });
}

namespace mksnapshot {

void CompileSerializeMain(const FunctionCallbackInfo<Value>& args) {
  CHECK(args[0]->IsString());
  Local<String> filename = args[0].As<String>();
  Local<String> source = args[1].As<String>();
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  ScriptOrigin origin(isolate, filename, 0, 0, true);
  // TODO(joyeecheung): do we need all of these? Maybe we would want a less
  // internal version of them.
  std::vector<Local<String>> parameters = {
      FIXED_ONE_BYTE_STRING(isolate, "require"),
      FIXED_ONE_BYTE_STRING(isolate, "__filename"),
      FIXED_ONE_BYTE_STRING(isolate, "__dirname"),
  };
  ScriptCompiler::Source script_source(source, origin);
  Local<Function> fn;
  if (ScriptCompiler::CompileFunctionInContext(context,
                                               &script_source,
                                               parameters.size(),
                                               parameters.data(),
                                               0,
                                               nullptr,
                                               ScriptCompiler::kEagerCompile)
          .ToLocal(&fn)) {
    args.GetReturnValue().Set(fn);
  }
}

void SetSerializeCallback(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  CHECK(env->snapshot_serialize_callback().IsEmpty());
  CHECK(args[0]->IsFunction());
  env->set_snapshot_serialize_callback(args[0].As<Function>());
}

void SetDeserializeCallback(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  CHECK(env->snapshot_deserialize_callback().IsEmpty());
  CHECK(args[0]->IsFunction());
  env->set_snapshot_deserialize_callback(args[0].As<Function>());
}

void SetDeserializeMainFunction(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  CHECK(env->snapshot_deserialize_main().IsEmpty());
  CHECK(args[0]->IsFunction());
  env->set_snapshot_deserialize_main(args[0].As<Function>());
}

void Initialize(Local<Object> target,
                Local<Value> unused,
                Local<Context> context,
                void* priv) {
  Environment* env = Environment::GetCurrent(context);
  env->SetMethod(target, "compileSerializeMain", CompileSerializeMain);
  env->SetMethod(target, "markBootstrapComplete", MarkBootstrapComplete);
  env->SetMethod(target, "setSerializeCallback", SetSerializeCallback);
  env->SetMethod(target, "setDeserializeCallback", SetDeserializeCallback);
  env->SetMethod(
      target, "setDeserializeMainFunction", SetDeserializeMainFunction);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CompileSerializeMain);
  registry->Register(MarkBootstrapComplete);
  registry->Register(SetSerializeCallback);
  registry->Register(SetDeserializeCallback);
  registry->Register(SetDeserializeMainFunction);
}
}  // namespace mksnapshot
}  // namespace node

NODE_MODULE_CONTEXT_AWARE_INTERNAL(mksnapshot, node::mksnapshot::Initialize)
NODE_MODULE_EXTERNAL_REFERENCE(mksnapshot,
                               node::mksnapshot::RegisterExternalReferences)
