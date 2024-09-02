#include "node_rc.h"
#include "env.h"
#include "node_internals.h"

namespace node {

bool RuntimeConfig::initialized_ = false;
void RuntimeConfig::Initialize(std::filesystem::path base) {
  CHECK(!RuntimeConfig::initialized_);
  auto cleanup = OnScopeLeave([&]() { RuntimeConfig::initialized_ = true; });
  auto root_path = base.root_path();

  // TODO(joyeecheung): cache this with the type-finding package.json reader.
  std::string raw_package_json;
  std::filesystem::path package_json_path;
  simdjson::ondemand::parser json_parser;
  std::string_view rc_file_path;

  for (auto directory_path = base;
       !std::filesystem::equivalent(root_path, directory_path);
       directory_path = directory_path.parent_path()) {
    package_json_path = base / "package.json";
    std::u8string path_u8 = package_json_path.u8string();
    if (ReadFileSync(&raw_package_json, reinterpret_cast<const char*>(path_u8.c_str())) == 0) {
      simdjson::ondemand::document document;
      simdjson::ondemand::object main_object;
      simdjson::error_code error = json_parser.iterate(raw_package_json).get(document);
      if (error || document.get_object().get(main_object)) {
        continue;
      }
      simdjson::ondemand::value noderc;
      if (main_object["noderc"].get(noderc)) {
        continue;
      }

      switch(noderc.type()) {
        case simdjson::ondemand::json_type::object: {
          simdjson::ondemand::object rc_object;
          CHECK(noderc.get_object().get(rc_object));
          simdjson::ondemand::value rc_value;
          std::string rc_key = "default";
          credentials::SafeGetenv("NODE_RC", &rc_key);
          if (!rc_object[rc_key].get(rc_value) || !rc_value.get_string(rc_file_path)) {
            return;
          }
          break;
        }
        case simdjson::ondemand::json_type::string: {
          if (!noderc.get_string(rc_file_path)) {
            return;
          }
          break;
        }
        default:
          return;
      }
      break;
    }
  }

  auto rc_path = (package_json_path.parent_path() / std::filesystem::path(rc_file_path)).u8string();
  if (ReadFileSync(&per_process::node_rc_raw_json, reinterpret_cast<const char*>(rc_path.c_str()))) {
    return;
  }
  // TODO(joyeecheung): parse the content of the rc file and fill it into RuntimeConfig.
}

} // namespace node
