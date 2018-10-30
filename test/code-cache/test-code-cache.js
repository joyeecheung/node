'use strict';

// Flags: --expose-internals
// This test verifies that if the binary is compiled with code cache,
// and the cache is used when built in modules are compiled.
// Otherwise, verifies that no cache is used when compiling builtins.

require('../common');
const assert = require('assert');
const {
  types: {
    isUint8Array
  }
} = require('util');
const {
  cachableBuiltins,
  cannotUseCache,
  codeCache,
  compiledWithCache,
  compiledWithoutCache
} = require('internal/bootstrap/cache');

for (const key of cachableBuiltins) {
  if (!cannotUseCache.includes(key)) {
    require(key);
  }
}

const loadedModules = process.moduleLoadList
  .filter((m) => m.startsWith('NativeModule'))
  .map((m) => m.replace('NativeModule ', ''));

// The binary is not configured with code cache, verifies that the builtins
// are all compiled without cache and we are doing the bookkeeping right.
if (process.config.variables.node_code_cache_path === undefined) {
  console.log('The binary is not configured with code cache');
  assert.deepStrictEqual(compiledWithCache, []);
  assert.notStrictEqual(compiledWithoutCache.length, 0);

  for (const key of loadedModules) {
    assert(compiledWithoutCache.includes(key),
           `"${key}" should not have been compiled with code cache`);
  }
} else {
  console.log('The binary is configured with code cache');
  assert.strictEqual(
    typeof process.config.variables.node_code_cache_path,
    'string'
  );

  for (const key of compiledWithoutCache) {
    assert.ok(cannotUseCache.includes(key));
  }

  for (const key of loadedModules) {
    if (!cannotUseCache.includes(key)) {
      assert(compiledWithCache.includes(key),
            `"${key}" should've been compiled with code cache`);
    }
  }

  for (const key of cachableBuiltins) {
    if (!cannotUseCache.includes(key)) {
      assert(isUint8Array(codeCache[key]) && codeCache[key].length > 0,
             `Code cache for "${key}" should've been generated`);
    }
  }
}
