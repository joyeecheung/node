#include "node_sea.h"

#ifdef HAVE_LIEF
#include "LIEF/LIEF.hpp"
#endif  // HAVE_LIEF

#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_exit_code.h"
#include "util-inl.h"

#include <algorithm>
#include <codecvt>
#include <fstream>
#include <iostream>
#include <locale>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

// The POSTJECT_SENTINEL_FUSE macro is a string of random characters selected by
// the Node.js project that is present only once in the entire binary. It is
// used by the postject_has_resource() function to efficiently detect if a
// resource has been injected. See
// https://github.com/nodejs/postject/blob/35343439cac8c488f2596d7c4c1dddfec1fddcae/postject-api.h#L42-L45.
#define POSTJECT_SENTINEL_FUSE "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
static constexpr const char* kSentinelFuse = POSTJECT_SENTINEL_FUSE;
#include "postject-api.h"
#undef POSTJECT_SENTINEL_FUSE

static constexpr const char* kSEAResourceName = "NODE_SEA_BLOB";
static constexpr const char* kELFSectionName = ".note.node.sea";
static constexpr const char* kMachoSegmentName = "NODE_SEA";

namespace node {
namespace sea {

std::string_view FindSingleExecutableBlob() {
#if !defined(DISABLE_SINGLE_EXECUTABLE_APPLICATION)
  CHECK(IsSingleExecutable());
  static const std::string_view result = []() -> std::string_view {
    size_t size;
#ifdef __APPLE__
    postject_options options;
    postject_options_init(&options);
    options.macho_segment_name = "NODE_SEA";
    const char* blob = static_cast<const char*>(
        postject_find_resource("NODE_SEA_BLOB", &size, &options));
#else
    const char* blob = static_cast<const char*>(
        postject_find_resource("NODE_SEA_BLOB", &size, nullptr));
#endif
    return {blob, size};
  }();
  per_process::Debug(DebugCategory::SEA,
                     "Found SEA blob %p, size=%zu\n",
                     result.data(),
                     result.size());
  return result;
#else
  UNREACHABLE();
#endif  // !defined(DISABLE_SINGLE_EXECUTABLE_APPLICATION)
}

bool IsSingleExecutable() {
  return postject_has_resource();
}

// Public enum describing injection result
enum class InjectResult { kAlreadyExists, kError, kSuccess, kUnknownFormat };

// Result struct returned by injection helpers
struct InjectOutput {
  InjectResult result;
  std::vector<uint8_t> data;  // Empty if result != kSuccess
};

InjectOutput InjectIntoElf(const std::vector<uint8_t>& executable,
                           const std::string& note_name,
                           const std::vector<uint8_t>& data,
                           bool overwrite = false) {
  InjectOutput out{InjectResult::kError, {}};

  std::unique_ptr<LIEF::ELF::Binary> binary =
      LIEF::ELF::Parser::parse(executable);
  if (!binary) {
    return out;
  }

  constexpr uint32_t kNoteType = 0;  // vendor-specific

  LIEF::ELF::Note* existing_note = nullptr;
  for (const auto& n : binary->notes()) {  // notes() yields unique_ptr<Note>
    if (n.name() == note_name && static_cast<uint32_t>(n.type()) == kNoteType) {
      existing_note = n.clone().release();
      break;
    }
  }

  if (existing_note) {
    fprintf(stdout,
            "Existing note found: %s (type: %u)\n",
            existing_note->name().c_str(),
            static_cast<uint32_t>(existing_note->type()));
    if (!overwrite) {
      out.result = InjectResult::kAlreadyExists;
      return out;
    }
    binary->remove(*existing_note);
  } else {
    fprintf(stdout, "No existing note found. Proceeding to add new note.\n");
  }

  auto new_note =
      LIEF::ELF::Note::create(note_name, kNoteType, data, kELFSectionName);
  if (!new_note) {
    fprintf(stderr, "Failed to create new ELF note\n");
    return out;  // keep kError
  }
  binary->add(*new_note);

  LIEF::ELF::Builder::config_t cfg;
  cfg.notes = true;            // Ensure notes are rebuilt
  cfg.dynamic_section = true;  // Ensure PT_DYNAMIC is rebuilt
  LIEF::ELF::Builder builder(*binary, cfg);
  builder.build();
  out.data = builder.get_build();
  if (out.data.empty()) {
    out.result = InjectResult::kError;
  }
  out.result = InjectResult::kSuccess;
  return out;
}

InjectOutput InjectIntoMacho(const std::vector<uint8_t>& executable,
                             const std::string& segment_name,
                             const std::string& section_name,
                             const std::vector<uint8_t>& data,
                             bool overwrite = false) {
  InjectOutput out{InjectResult::kError, {}};
  std::unique_ptr<LIEF::MachO::FatBinary> fat_binary =
      LIEF::MachO::Parser::parse(executable);
  if (!fat_binary) {
    return out;
  }

  for (auto& binary :
       *fat_binary) {  // FatBinary is iterable over unique_ptr<Binary>
    LIEF::MachO::Section* existing_section =
        binary.get_section(segment_name, section_name);
    if (existing_section) {
      if (!overwrite) {
        out.result = InjectResult::kAlreadyExists;
        return out;  // Abort early if any binary already has section
      }
      binary.remove_section(segment_name, section_name, true);
    }

    LIEF::MachO::SegmentCommand* segment = binary.get_segment(segment_name);
    LIEF::MachO::Section section(section_name, data);
    if (!segment) {
      LIEF::MachO::SegmentCommand new_segment(segment_name);
      // Use SegmentCommand::VM_PROTECTIONS enum values (READ)
      new_segment.max_protection(static_cast<uint32_t>(
          LIEF::MachO::SegmentCommand::VM_PROTECTIONS::READ));
      new_segment.init_protection(static_cast<uint32_t>(
          LIEF::MachO::SegmentCommand::VM_PROTECTIONS::READ));
      new_segment.add_section(section);
      binary.add(new_segment);
    } else {
      binary.add_section(*segment, section);
    }

    if (binary.has_code_signature()) {
      binary.remove_signature();
    }
  }

  out.data = fat_binary->raw();
  out.result = InjectResult::kSuccess;
  return out;
}

InjectOutput InjectIntoPe(const std::vector<uint8_t>& executable,
                          const std::string& resource_name,
                          const std::vector<uint8_t>& data,
                          bool overwrite = false) {
  InjectOutput out{InjectResult::kError, {}};
  std::unique_ptr<LIEF::PE::Binary> binary =
      LIEF::PE::Parser::parse(executable);
  if (!binary) {
    return out;
  }
  if (!binary->has_resources()) {
    return out;  // Could enhance by building a tree
  }

  LIEF::PE::ResourceNode* resources = binary->resources();
  LIEF::PE::ResourceNode* rcdata_node = nullptr;
  LIEF::PE::ResourceNode* id_node = nullptr;

  constexpr uint32_t RCDATA_ID =
      static_cast<uint32_t>(LIEF::PE::ResourcesManager::TYPE::RCDATA);
  auto rcdata_node_iter = std::find_if(std::begin(resources->childs()),
                                       std::end(resources->childs()),
                                       [](const LIEF::PE::ResourceNode& node) {
                                         return node.id() == RCDATA_ID;
                                       });
  if (rcdata_node_iter != std::end(resources->childs())) {
    rcdata_node = &*rcdata_node_iter;
  } else {
    LIEF::PE::ResourceDirectory new_rcdata_node;
    new_rcdata_node.id(RCDATA_ID);
    rcdata_node = &resources->add_child(new_rcdata_node);
  }

  auto id_node_iter = std::find_if(
      std::begin(rcdata_node->childs()),
      std::end(rcdata_node->childs()),
      [resource_name](const LIEF::PE::ResourceNode& node) {
        // TODO(joyeecheung): use simdutf for better performance
        return node.name() ==
               std::wstring_convert<std::codecvt_utf8_utf16<char16_t>,
                                    char16_t>{}
                   .from_bytes(resource_name);
      });
  if (id_node_iter != std::end(rcdata_node->childs())) {
    id_node = &*id_node_iter;
  } else {
    LIEF::PE::ResourceDirectory new_id_node;
    new_id_node.name(resource_name);
    new_id_node.id(0x80000000);  // Force persistence of name
    id_node = &rcdata_node->add_child(new_id_node);
  }

  if (id_node->childs() != std::end(id_node->childs())) {
    if (!overwrite) {
      out.result = InjectResult::kAlreadyExists;
      return out;
    }
    id_node->delete_child(*id_node->childs());
  }

  LIEF::PE::ResourceData lang_node(data);
  id_node->add_child(lang_node);

  // Rebuild resources using Builder config struct
  LIEF::PE::Builder::config_t cfg;  // defaults: resources=true etc.
  cfg.resources = true;
  cfg.rsrc_section = ".rsrc";  // ensure section name
  LIEF::PE::Builder builder(*binary, cfg);
  if (builder.build()) {  // ok_error_t convertible to bool (true if ok)
    out.data = builder.get_build();
    out.result = InjectResult::kSuccess;
  }
  return out;
}

std::vector<uint8_t> ReadAll(const std::string& path) {
  std::ifstream file(
      path,
      std::ios::binary | std::ios::ate);  // Open in binary mode and seek to end

  if (!file.is_open()) {
    fprintf(stderr, "Error: Could not open file %s\n", path.c_str());
    return {};  // Return empty vector on error
  }

  std::streamsize size = file.tellg();  // Get file size
  if (size == -1) {
    fprintf(
        stderr, "Error: Could not determine file size for %s\n", path.c_str());
    return {};
  }

  std::vector<uint8_t> buffer(size);  // Create vector of appropriate size

  file.seekg(0, std::ios::beg);  // Seek back to beginning of file
  file.read(reinterpret_cast<char*>(buffer.data()),
            size);  // Read entire file into buffer

  file.close();  // Close the file

  return buffer;
}

bool WriteAll(const std::string& path, const std::vector<uint8_t>& data) {
  std::ofstream outfile(path, std::ios::out | std::ios::binary);

  if (outfile.is_open()) {
    outfile.write(reinterpret_cast<const char*>(data.data()), data.size());
    outfile.close();
    return true;
  } else {
    return false;
  }
}

bool MarkSentinel(std::vector<uint8_t>& data,
                  const std::string& sentinel_fuse) {
  // Search for the full sentinel with colon to avoid matching the bare constant
  std::string fuse_with_colon = sentinel_fuse + ":";
  std::string_view data_view(reinterpret_cast<char*>(data.data()), data.size());

  size_t first_pos = data_view.find(fuse_with_colon);
  if (first_pos == std::string::npos) {
    fprintf(stderr, "Error: sentinel not found\n");
    return false;
  }

  size_t last_pos = data_view.rfind(fuse_with_colon);
  if (first_pos != last_pos) {
    fprintf(stderr, "Error: multiple sentinel occurrences\n");
    return false;
  }

  size_t idx = first_pos + fuse_with_colon.size();
  if (idx >= data_view.size()) {
    fprintf(stderr, "Error: sentinel index out of range\n");
    return false;
  }

  fprintf(stderr,
          "Fuse: %.*s\n",
          static_cast<int>(fuse_with_colon.size() + 1),
          data_view.substr(first_pos, fuse_with_colon.size() + 1).data());

  if (data_view[idx] == '0') {
    data.data()[idx] = '1';
  } else if (data_view[idx] != '1') {
    fprintf(stderr, "Error: invalid sentinel value\n");
    return false;
  }

  fprintf(stderr,
          "Fuse: %.*s\n",
          static_cast<int>(fuse_with_colon.size() + 1),
          data_view.substr(first_pos, fuse_with_colon.size() + 1).data());

  return true;
}

InjectOutput InjectResourceAndMarkSentinel(
    const std::vector<uint8_t>& exe,
    const std::string& resource_name,
    const std::vector<uint8_t>& res,
    const std::string& macho_segment_name,
    const std::string& sentinel_fuse,
    bool overwrite) {
  InjectOutput out{InjectResult::kError, {}};

  if (LIEF::ELF::is_elf(exe)) {
    out = InjectIntoElf(exe, resource_name, res, overwrite);
    if (out.result == InjectResult::kAlreadyExists) {
      fprintf(stderr,
              "Error: Section %s exists: %s\n"
              "Use \"overwriteExisting\": true to overwrite\n",
              kELFSectionName,
              resource_name.c_str());
    }
  } else if (LIEF::MachO::is_macho(exe)) {
    std::string sec = resource_name;
    if (!(sec.rfind("__", 0) == 0)) sec = "__" + sec;
    out = InjectIntoMacho(exe, macho_segment_name, sec, res, overwrite);
    if (out.result == InjectResult::kAlreadyExists) {
      fprintf(stderr,
              "Error: Segment/section %s/%s exists\n"
              "Use \"overwriteExisting\": true to overwrite\n",
              kMachoSegmentName,
              sec.c_str());
    }
  } else if (LIEF::PE::is_pe(exe)) {
    std::string upper_name = resource_name;
    // To upper case
    std::transform(upper_name.begin(),
                   upper_name.end(),
                   upper_name.begin(),
                   [](unsigned char c) { return std::toupper(c); });
    out = InjectIntoPe(exe, upper_name, res, overwrite);
    if (out.result == InjectResult::kAlreadyExists) {
      fprintf(stderr,
              "Error: Resource %s exists\n"
              "Use \"overwriteExisting\": true to overwrite\n",
              upper_name.c_str());
    }
  } else {
    out.result = InjectResult::kUnknownFormat;
  }

  if (out.result == InjectResult::kSuccess &&
      !MarkSentinel(out.data, sentinel_fuse)) {
    out.result = InjectResult::kError;
  }

  return out;
}

ExitCode BuildSingleExecutable(const std::string& sea_config_path,
                               const std::vector<std::string>& args,
                               const std::vector<std::string>& exec_args) {
  std::optional<SeaConfig> opt_config =
      ParseSingleExecutableConfig(sea_config_path);
  if (!opt_config.has_value()) {
    return ExitCode::kGenericUserError;
  }

  SeaConfig config = opt_config.value();
  if (config.executable_path.empty()) {
    config.executable_path = args[0];
  }

  // Get file permissions from source executable
  uv_fs_t req;
  int r = uv_fs_stat(nullptr, &req, config.executable_path.c_str(), nullptr);
  if (r != 0) {
    fprintf(stderr,
            "Error: Couldn't stat executable: %s\n",
            config.executable_path.c_str());
    uv_fs_req_cleanup(&req);
    return ExitCode::kGenericUserError;
  }
  int src_mode = req.statbuf.st_mode;
  uv_fs_req_cleanup(&req);

  std::string exe;
  r = ReadFileSync(&exe, config.executable_path.c_str());
  if (r != 0) {
    fprintf(stderr,
            "Error: Couldn't read executable: %s\n",
            config.executable_path.c_str());
    return ExitCode::kGenericUserError;
  }

  // TODO(joyeecheung): add a variant of ReadFileSync that reads into
  // vector<uint8_t>
  std::vector<uint8_t> exe_data(exe.begin(), exe.end());
  std::vector<char> sea_blob;
  ExitCode code =
      GenerateSingleExecutableBlob(&sea_blob, config, args, exec_args);
  if (code != ExitCode::kNoFailure) {
    return code;
  }
  // TODO(joyeecheung): refactor serializer implementation and avoid copying
  std::vector<uint8_t> sea_blob_u8(sea_blob.begin(), sea_blob.end());
  InjectOutput out = InjectResourceAndMarkSentinel(exe_data,
                                                   kSEAResourceName,
                                                   sea_blob_u8,
                                                   kMachoSegmentName,
                                                   kSentinelFuse,
                                                   config.overwrite_existing);
  if (out.result == InjectResult::kUnknownFormat) {
    fprintf(
        stderr,
        "Error: Executable must be a supported format: ELF, PE, or Mach-O\n");
    return ExitCode::kGenericUserError;
  }
  if (out.result == InjectResult::kAlreadyExists) {
    return ExitCode::kGenericUserError;
  }
  if (out.result != InjectResult::kSuccess) {
    fprintf(stderr, "Error when injecting resource\n");
    return ExitCode::kGenericUserError;
  }

  bool write_ok = WriteAll(config.output_path, out.data);
  if (!write_ok) {
    fprintf(stderr,
            "Error: Couldn't write output executable: %s\n",
            config.output_path.c_str());
    return ExitCode::kGenericUserError;
  }

  // Copy file permissions (including execute bit) from source executable
  r = uv_fs_chmod(nullptr, &req, config.output_path.c_str(), src_mode, nullptr);
  uv_fs_req_cleanup(&req);
  if (r != 0) {
    fprintf(stderr,
            "Warning: Couldn't set permissions on output: %s\n",
            config.output_path.c_str());
  }

  fprintf(stdout, "\x1b[32m\xF0\x9F\x92\x89 Injection done!\x1b[0m\n");
  return ExitCode::kNoFailure;
}

}  // namespace sea
}  // namespace node
