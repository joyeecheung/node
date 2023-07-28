#ifndef SRC_NODE_CONTEXT_DATA_H_
#define SRC_NODE_CONTEXT_DATA_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "util.h"
#include "v8.h"

namespace node {

// Pick an index that's hopefully out of the way when we're embedded inside
// another application. Performance-wise or memory-wise it doesn't matter:
// Context::SetAlignedPointerInEmbedderData() is backed by a FixedArray,
// worst case we pay a one-time penalty for resizing the array.
#ifndef NODE_CONTEXT_EMBEDDER_DATA_INDEX
#define NODE_CONTEXT_EMBEDDER_DATA_INDEX 32
#endif

#ifndef NODE_CONTEXT_SANDBOX_OBJECT_INDEX
#define NODE_CONTEXT_SANDBOX_OBJECT_INDEX 33
#endif

#ifndef NODE_CONTEXT_FLAGS_INDEX
#define NODE_CONTEXT_FLAGS_INDEX 34
#endif

#ifndef NODE_BINDING_DATA_STORE_INDEX
#define NODE_BINDING_DATA_STORE_INDEX 35
#endif

#ifndef NODE_CONTEXT_ALLOW_CODE_GENERATION_FROM_STRINGS_INDEX
#define NODE_CONTEXT_ALLOW_CODE_GENERATION_FROM_STRINGS_INDEX 36
#endif

#ifndef NODE_CONTEXT_CONTEXTIFY_CONTEXT_INDEX
#define NODE_CONTEXT_CONTEXTIFY_CONTEXT_INDEX 37
#endif

#ifndef NODE_CONTEXT_REALM_INDEX
#define NODE_CONTEXT_REALM_INDEX 38
#endif

// NODE_CONTEXT_TAG must be greater than any embedder indexes so that a single
// check on the number of embedder data fields can assure the presence of all
// embedder indexes.
#ifndef NODE_CONTEXT_TAG
#define NODE_CONTEXT_TAG 39
#endif

enum ContextEmbedderIndex {
  kEnvironment = NODE_CONTEXT_EMBEDDER_DATA_INDEX,
  kSandboxObject = NODE_CONTEXT_SANDBOX_OBJECT_INDEX,
  kFlags = NODE_CONTEXT_FLAGS_INDEX,
  kContextifyContext = NODE_CONTEXT_CONTEXTIFY_CONTEXT_INDEX,
  kRealm = NODE_CONTEXT_REALM_INDEX,
  kContextTag = NODE_CONTEXT_TAG,
};

enum class ContextFlags : uint32_t {
  kNone = 0,
  kAllowWasmCodeGeneration = 1 << 0,
  kAllowCodeGenerationFromStrings = 1 << 1,
};
ContextFlags operator|(ContextFlags x, ContextFlags y);
ContextFlags operator&(ContextFlags x, ContextFlags y);
ContextFlags operator|=(/* NOLINT (runtime/references) */ ContextFlags& x,
                        ContextFlags y);
ContextFlags operator&=(/* NOLINT (runtime/references) */ ContextFlags& x,
                        ContextFlags y);
ContextFlags operator~(ContextFlags x);

// Get the context flags, if it's not set by Node.js, return empty.
v8::Maybe<ContextFlags> GetContextFlags(v8::Local<v8::Context> context);
// Set the context flags in one go.
void ResetContextFlags(v8::Local<v8::Context> context, ContextFlags flags);
// If the flag is not set by Node.js, return false,
// otherwise if all the bits in the mask are set, return true.
bool TestContextFlag(v8::Local<v8::Context> context, ContextFlags mask);
// Set all the flags in the mask.
void SetContextFlag(v8::Local<v8::Context> context, ContextFlags mask);
// Clear all the flags in the mask.
void ClearContextFlag(v8::Local<v8::Context> context, ContextFlags mask);

class ContextEmbedderTag {
 public:
  static inline void TagNodeContext(v8::Local<v8::Context> context) {
    // Used by ContextEmbedderTag::IsNodeContext to know that we are on a node
    // context.
    context->SetAlignedPointerInEmbedderData(
        ContextEmbedderIndex::kContextTag,
        ContextEmbedderTag::kNodeContextTagPtr);
  }

  static inline bool IsNodeContext(v8::Local<v8::Context> context) {
    if (UNLIKELY(context.IsEmpty())) {
      return false;
    }
    if (UNLIKELY(context->GetNumberOfEmbedderDataFields() <=
                 ContextEmbedderIndex::kContextTag)) {
      return false;
    }
    if (UNLIKELY(context->GetAlignedPointerFromEmbedderData(
                     ContextEmbedderIndex::kContextTag) !=
                 ContextEmbedderTag::kNodeContextTagPtr)) {
      return false;
    }
    return true;
  }

 private:
  static void* const kNodeContextTagPtr;
  static int const kNodeContextTag;

  ContextEmbedderTag() = delete;
};

}  // namespace node

#endif  // defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#endif  // SRC_NODE_CONTEXT_DATA_H_
