// Flags: --experimental-require-module
'use strict';

require('../common');
const assert = require('assert');
const { isModuleNamespaceObject } = require('util/types');
const { spawnSyncAndExit, spawnSyncAndAssert } = require('../common/child_process');
const fixtures = require('../common/fixtures');

{
  // test.cjs -> b.cjs -> a.mjs -> b.cjs is okay, because the CJS loader can
  // cache b.cjs in the first edge, and a.mjs is only loading a facade of the cached b.cjs.
  const result = require('../fixtures/es-modules/esm-cjs-esm-cycle/b.cjs');
  assert(isModuleNamespaceObject(result));
  assert.deepStrictEqual({...result}, { default: 'hello' });
}

{
  // test.cjs -> a.mjs -> b.cjs -> a.mjs is okay, because the ESM loader can
  // cache a.mjs in the first edge, and b.cjs is only loading the cached a.mjs.
  const result = require('../fixtures/es-modules/esm-cjs-esm-cycle/a.mjs');
  assert(isModuleNamespaceObject(result));
  assert.deepStrictEqual({...result}, { default: 'hello' });
}

// a.mjs -> b.cjs -> a.mjs is currently not okay because a.mjs, as the
// entrypoint, is loaded by the default ESM loader which loads everything
// unconditionally async, so b.cjs won't be able to get the namespace of a.mjs
// synchronously yet.
// FIXME(joyeecheung): make the default ESM loader conditionally synchronous
// when the entrypoint doesn't contain TLA, so it doesn't throw if a.mjs
// contains no TLA.
{
  spawnSyncAndExit(process.execPath,
    [
      '--experimental-require-module',
      fixtures.path('es-modules/esm-cjs-esm-cycle/a.mjs')
    ],
    {
      signal: null,
      status: 1,
      stderr: /Cannot get namespace, module is being evaluated/,
    });
}

// b.cjs -> a.mjs -> b.cjs is okay, because it's fully synchronous, and b.cjs
// is loaded synchronously and gets cached by the CJS loader.
{
  spawnSyncAndAssert(process.execPath,
    [
      '--experimental-require-module',
      fixtures.path('es-modules/esm-cjs-esm-cycle/b.cjs')
    ],
    {
      trim: true,
      stdout: 'import b.cjs from a.mjs {}\nrequire a.mjs in b.cjs hello'
    });
}
