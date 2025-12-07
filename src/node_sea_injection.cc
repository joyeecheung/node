#include "node_sea.h"

#ifdef HAVE_LIEF
#include "LIEF/LIEF.hpp"
#endif  // HAVE_LIEF

#include "debug_utils-inl.h"
#include "env-inl.h"
#include "util-inl.h"

#include <algorithm>
#include <codecvt>
#include <locale>
#include <memory>
#include <vector>
#include <string>
#include <iostream>
#include <fstream>
#include <sstream>
#include <string_view>

// The POSTJECT_SENTINEL_FUSE macro is a string of random characters selected by
// the Node.js project that is present only once in the entire binary. It is
// used by the postject_has_resource() function to efficiently detect if a
// resource has been injected. See
// https://github.com/nodejs/postject/blob/35343439cac8c488f2596d7c4c1dddfec1fddcae/postject-api.h#L42-L45.
#define POSTJECT_SENTINEL_FUSE "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
#include "postject-api.h"
#undef POSTJECT_SENTINEL_FUSE

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

// Public enums describing executable format and injection result
enum class ExecutableFormat
{
  kELF,
  kMachO,
  kPE,
  kUnknown
};
enum class InjectResult
{
  kAlreadyExists,
  kError,
  kSuccess
};

// Result struct returned by injection helpers
struct InjectOutput
{
  InjectResult result;
  std::vector<uint8_t> data; // Empty if result != kSuccess
};

ExecutableFormat get_executable_format(const std::vector<uint8_t> &buffer)
{
  if (LIEF::ELF::is_elf(buffer))
  {
    return ExecutableFormat::kELF;
  }
  else if (LIEF::MachO::is_macho(buffer))
  {
    return ExecutableFormat::kMachO;
  }
  else if (LIEF::PE::is_pe(buffer))
  {
    return ExecutableFormat::kPE;
  }
  return ExecutableFormat::kUnknown;
}

InjectOutput inject_into_elf(const std::vector<uint8_t> &executable,
                             const std::string &note_name,
                             const std::vector<uint8_t> &data,
                             bool overwrite = false)
{
  InjectOutput out{InjectResult::kError, {}};

  std::unique_ptr<LIEF::ELF::Binary> binary = LIEF::ELF::Parser::parse(executable);
  if (!binary)
  {
    return out;
  }

  constexpr uint32_t kNoteType = 0; // vendor-specific

  LIEF::ELF::Note* existing_note = nullptr;
  for (const auto &n : binary->notes())
  { // notes() yields unique_ptr<Note>
    if (n.name() == note_name && static_cast<uint32_t>(n.type()) == kNoteType)
    {
      existing_note = n.clone().release();
      break;
    }
  }

  if (existing_note)
  {
    printf("Existing note found: %s (type: %u)\n", existing_note->name().c_str(), static_cast<uint32_t>(existing_note->type()));
    if (!overwrite)
    {
      out.result = InjectResult::kAlreadyExists;
      return out;
    }
    binary->remove(*existing_note);
  } else {
    printf("No existing note found. Proceeding to add new note.\n");
  }

  // This is not working?
  auto new_note = LIEF::ELF::Note::create(note_name, kNoteType, data, ".note.node.sea");
  if (!new_note)
  {
    printf("Failed to create new ELF note\n");
    return out; // keep kError
  }
  binary->add(*new_note);

  LIEF::ELF::Builder::config_t cfg;
  cfg.notes = true; // Ensure notes are rebuilt
  cfg.dynamic_section = true; // Ensure PT_DYNAMIC is rebuilt
  LIEF::ELF::Builder builder(*binary);
  builder.build();
  out.data = builder.get_build();
  if (out.data.empty()) {
    out.result = InjectResult::kError;
  }
  out.result = InjectResult::kSuccess;
  return out;
}

InjectOutput inject_into_macho(const std::vector<uint8_t> &executable,
                               const std::string &segment_name,
                               const std::string &section_name,
                               const std::vector<uint8_t> &data,
                               bool overwrite = false)
{
  InjectOutput out{InjectResult::kError, {}};
  std::unique_ptr<LIEF::MachO::FatBinary> fat_binary = LIEF::MachO::Parser::parse(executable);
  if (!fat_binary)
  {
    return out;
  }

  for (auto &binary : *fat_binary)
  { // FatBinary is iterable over unique_ptr<Binary>
    LIEF::MachO::Section *existing_section = binary.get_section(segment_name, section_name);
    if (existing_section)
    {
      if (!overwrite)
      {
        out.result = InjectResult::kAlreadyExists;
        return out; // Abort early if any binary already has section
      }
      binary.remove_section(segment_name, section_name, true);
    }

    LIEF::MachO::SegmentCommand *segment = binary.get_segment(segment_name);
    LIEF::MachO::Section section(section_name, data);
    if (!segment)
    {
      LIEF::MachO::SegmentCommand new_segment(segment_name);
      // Use SegmentCommand::VM_PROTECTIONS enum values (READ)
      new_segment.max_protection(static_cast<uint32_t>(LIEF::MachO::SegmentCommand::VM_PROTECTIONS::READ));
      new_segment.init_protection(static_cast<uint32_t>(LIEF::MachO::SegmentCommand::VM_PROTECTIONS::READ));
      new_segment.add_section(section);
      binary.add(new_segment);
    }
    else
    {
      binary.add_section(*segment, section);
    }

    if (binary.has_code_signature())
    {
      binary.remove_signature();
    }
  }

  out.data = fat_binary->raw();
  out.result = InjectResult::kSuccess;
  return out;
}

InjectOutput inject_into_pe(const std::vector<uint8_t> &executable,
                            const std::string &resource_name,
                            const std::vector<uint8_t> &data,
                            bool overwrite = false)
{
  InjectOutput out{InjectResult::kError, {}};
  std::unique_ptr<LIEF::PE::Binary> binary = LIEF::PE::Parser::parse(executable);
  if (!binary)
  {
    return out;
  }
  if (!binary->has_resources())
  {
    return out; // Could enhance by building a tree
  }

  LIEF::PE::ResourceNode *resources = binary->resources();
  LIEF::PE::ResourceNode *rcdata_node = nullptr;
  LIEF::PE::ResourceNode *id_node = nullptr;

  constexpr uint32_t RCDATA_ID = static_cast<uint32_t>(LIEF::PE::ResourcesManager::TYPE::RCDATA);
  auto rcdata_node_iter = std::find_if(std::begin(resources->childs()), std::end(resources->childs()),
                                       [](const LIEF::PE::ResourceNode &node)
                                       { return node.id() == RCDATA_ID; });
  if (rcdata_node_iter != std::end(resources->childs()))
  {
    rcdata_node = &*rcdata_node_iter;
  }
  else
  {
    LIEF::PE::ResourceDirectory new_rcdata_node;
    new_rcdata_node.id(RCDATA_ID);
    rcdata_node = &resources->add_child(new_rcdata_node);
  }

  auto id_node_iter = std::find_if(std::begin(rcdata_node->childs()), std::end(rcdata_node->childs()),
                                   [resource_name](const LIEF::PE::ResourceNode &node)
                                   {
                                     return node.name() == std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.from_bytes(resource_name);
                                   });
  if (id_node_iter != std::end(rcdata_node->childs()))
  {
    id_node = &*id_node_iter;
  }
  else
  {
    LIEF::PE::ResourceDirectory new_id_node;
    new_id_node.name(resource_name);
    new_id_node.id(0x80000000); // Force persistence of name
    id_node = &rcdata_node->add_child(new_id_node);
  }

  if (id_node->childs() != std::end(id_node->childs()))
  {
    if (!overwrite)
    {
      out.result = InjectResult::kAlreadyExists;
      return out;
    }
    id_node->delete_child(*id_node->childs());
  }

  LIEF::PE::ResourceData lang_node(data);
  id_node->add_child(lang_node);

  // Rebuild resources using Builder config struct
  LIEF::PE::Builder::config_t cfg; // defaults: resources=true etc.
  cfg.resources = true;
  cfg.rsrc_section = ".rsrc"; // ensure section name
  LIEF::PE::Builder builder(*binary, cfg);
  if (builder.build())
  { // ok_error_t convertible to bool (true if ok)
    out.data = builder.get_build();
    out.result = InjectResult::kSuccess;
  }
  return out;
}

std::vector<uint8_t> read_all(const std::string &path)
{
    std::ifstream file(path, std::ios::binary | std::ios::ate); // Open in binary mode and seek to end

    if (!file.is_open()) {
        std::cerr << "Error: Could not open file " << path << std::endl;
        return {}; // Return empty vector on error
    }

    std::streamsize size = file.tellg(); // Get file size
    if (size == -1) {
        std::cerr << "Error: Could not determine file size for " << path << std::endl;
        return {};
    }

    std::vector<uint8_t> buffer(size); // Create vector of appropriate size

    file.seekg(0, std::ios::beg); // Seek back to beginning of file
    file.read(reinterpret_cast<char*>(buffer.data()), size); // Read entire file into buffer

    file.close(); // Close the file

    return buffer;
}

bool write_all(const std::string &path, const std::vector<uint8_t> &data)
{
  std::ofstream outfile(path, std::ios::out | std::ios::binary);

  if (outfile.is_open()) {
      outfile.write(reinterpret_cast<const char*>(data.data()), data.size());
      outfile.close();
      return true;
  } else {
      return false;
  }
}

struct Opts {
  std::string macho_segment_name = "NODE_SEA";
  std::string sentinel_fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
  bool overwrite = false;
};

ExitCode BuildSingleExecutable(const std::string& config_path,
                          const std::vector<std::string>& args,
                          const std::vector<std::string>& exec_args) {
  std::optional<SeaConfig> config_opt = ParseSingleExecutableConfig(config_path);
  if (!config_opt.has_value()) {
    return ExitCode::kGenericUserError;
  }

  std::vector<char> blob;
  ExitCode code =
      GenerateSingleExecutableBlob(config_opt.value(), args, exec_args, &blob);
  if (code != ExitCode::kNoFailure) {
    return code;
  }

  SeaConfig config = config_opt.value();
  if (config.exe_path.empty()) {
    config.exe_path = args[0];  // Default to the execution binary.
  }
  std::string exe;
  int r = ReadFileSync(&exe, config.exe_path.c_str());
  if (r != 0) {
    const char* err = uv_strerror(r);
    FPrintF(stderr,
            "Cannot read single executable source binary from %s: %s\n",
            config.exe_path,
            err);
    return ExitCode::kGenericUserError;
  }

  FPrintF(stdout,
          "Start injection of %s + %s -> %s\n",
          config.exe_path,
          config.main_path,
          config.output_path,
          err);
  ExecutableFormat fmt = get_executable_format(exe);
  if (fmt == ExecutableFormat::kUnknown)
  {
    std::cerr << "Error: Executable must be a supported format: ELF, PE, or Mach-O\n";
    return 1;
  }
  InjectOutput out;
  switch (fmt)
  {
  case ExecutableFormat::kMachO:
  {
    std::string sec = resource_name;
    if (!(sec.rfind("__", 0) == 0))
      sec = "__" + sec;
    out = inject_into_macho(exe, opt.macho_segment_name, sec, res, opt.overwrite);
    if (out.result == InjectResult::kAlreadyExists)
    {
      std::cerr << "Error: Segment/section exists: " << opt.macho_segment_name << "/" << sec << "\nUse --overwrite to overwrite\n";
      return 1;
    }
    break;
  }
  case ExecutableFormat::kELF:
  {
    std::cerr << "Debug: Injecting into ELF\n";
    out = inject_into_elf(exe, resource_name, res, opt.overwrite);
    if (out.result == InjectResult::kAlreadyExists)
    {
      std::cerr << "Error: Section exists: " << resource_name << "\n"
                << "Use --overwrite to overwrite\n";
      return 1;
    }
    printf("Debug: Injection into ELF completed, %d\n", out.data == exe);
    break;
  }
  case ExecutableFormat::kPE:
  {
    std::string up = resource_name;
    std::transform(up.begin(), up.end(), up.begin(), [](unsigned char c)
                   { return std::toupper(c); });
    out = inject_into_pe(exe, up, res, opt.overwrite);
    if (out.result == InjectResult::kAlreadyExists)
    {
      std::cerr << "Error: Resource exists: " << up << "\n"
                << "Use --overwrite to overwrite\n";
      return 1;
    }
    break;
  }
  default:
    break;
  }
  if (out.result != InjectResult::kSuccess)
  {
    std::cerr << "Error when injecting resource\n";
    return 1;
  }
  std::string_view fuse(opt.sentinel_fuse);
  std::string_view data_view(reinterpret_cast<char*>(out.data.data()), out.data.size());
  size_t first = data_view.find(fuse);
  printf("Debug: Searching for fuse '%s' at position %zu\n", fuse.data(), first);
  if (first == std::string::npos) {
    std::cerr << "Error: sentinel not found\n";
    return 1;
  }
  size_t last = data_view.rfind(fuse);
  if (first != last) {
    std::cerr << "Error: multiple sentinel occurrences\n";
    return 1;
  }
  size_t colon = first + fuse.size();

  if (colon >= data_view.size() || data_view[colon] != ':') {
    std::cerr << "Error: missing ':' after sentinel\n";
    return 1;
  }
  size_t idx = colon + 1;
  if (idx >= data_view.size()) {
    std::cerr << "Error: sentinel index out of range\n";
    return 1;
  }

  std::cerr << "Fuse: " << data_view.substr(first, fuse.size() + 3) << '\n';

  if (data_view[idx] == '0') {
    out.data.data()[idx] = '1';
  } else if (data_view[idx] != '1') {
    std::cerr << "Error: invalid sentinel value\n";
    return 1;
  }
  printf("is unchanged: %s\n", (out.data == exe) ? "true" : "false");
  if (!write_all(filename, out.data)) {
    std::cerr << "Error: Couldn't write executable\n";
    return 1;
  }

  std::cerr << "Fuse: " << data_view.substr(first, fuse.size() + 3) << '\n';
  std::cout << "\x1b[32m\xF0\x9F\x92\x89 Injection done!\x1b[0m\n";
}

}  // namespace sea
}  // namespace node
