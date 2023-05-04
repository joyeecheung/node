#include "env-inl.h"
#include "memory_tracker.h"
#include "node.h"
#include "node_builtins.h"
#include "node_i18n.h"
#include "node_options.h"
#include "util-inl.h"

namespace node {

using v8::Context;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::ObjectTemplate;
using v8::Value;

// The config binding is used to provide an internal view of compile time
// config options that are required internally by lib/*.js code. This is an
// alternative to dropping additional properties onto the process object as
// has been the practice previously in node.cc.

// Command line arguments are already accessible in the JS land via
// require('internal/options').getOptionValue('--some-option'). Do not add them
// here.
namespace config {
static void CreatePerIsolateProperties(IsolateData* isolate_data,
                                       Local<FunctionTemplate> ctor) {
  Isolate* isolate = isolate_data->isolate();
  Local<ObjectTemplate> target = ctor->InstanceTemplate();

#if defined(DEBUG) && DEBUG
  READONLY_TRUE_PROPERTY_TMPL(target, "isDebugBuild");
#else
  READONLY_FALSE_PROPERTY_TMPL(target, "isDebugBuild");
#endif  // defined(DEBUG) && DEBUG

#if HAVE_OPENSSL
  READONLY_TRUE_PROPERTY_TMPL(target, "hasOpenSSL");
#else
  READONLY_FALSE_PROPERTY_TMPL(target, "hasOpenSSL");
#endif  // HAVE_OPENSSL

  READONLY_TRUE_PROPERTY_TMPL(target, "fipsMode");

#ifdef NODE_HAVE_I18N_SUPPORT

  READONLY_TRUE_PROPERTY_TMPL(target, "hasIntl");

#ifdef NODE_HAVE_SMALL_ICU
  READONLY_TRUE_PROPERTY_TMPL(target, "hasSmallICU");
#endif  // NODE_HAVE_SMALL_ICU

#if NODE_USE_V8_PLATFORM
  READONLY_TRUE_PROPERTY_TMPL(target, "hasTracing");
#endif

#if !defined(NODE_WITHOUT_NODE_OPTIONS)
  READONLY_TRUE_PROPERTY_TMPL(target, "hasNodeOptions");
#endif

#endif  // NODE_HAVE_I18N_SUPPORT

#if HAVE_INSPECTOR
  READONLY_TRUE_PROPERTY_TMPL(target, "hasInspector");
#else
  READONLY_FALSE_PROPERTY_TMPL(target, "hasInspector");
#endif

// configure --no-browser-globals
#ifdef NODE_NO_BROWSER_GLOBALS
  READONLY_TRUE_PROPERTY_TMPL(target, "noBrowserGlobals");
#else
  READONLY_FALSE_PROPERTY_TMPL(target, "noBrowserGlobals");
#endif  // NODE_NO_BROWSER_GLOBALS

  READONLY_PROPERTY_TMPL(
      target, "bits", Number::New(isolate, 8 * sizeof(intptr_t)));
}  // InitConfig

static void CreatePerContextProperties(v8::Local<v8::Object> target,
                                       v8::Local<v8::Value> unused,
                                       v8::Local<v8::Context> context,
                                       void* priv) {}
}  // namespace config
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(config,
                                    node::config::CreatePerContextProperties)
NODE_BINDING_PER_ISOLATE_INIT(config, node::config::CreatePerIsolateProperties)
