// Flags: --experimental-require-module
'use strict';

const common = require('../common');  // This is a test too.
const assert = require('assert');
const { isModuleNamespaceObject } = require('util/types');

{
  const mjs = require('../common/index.mjs');
  // Only comparing a few properties because the ESM version doesn't re-export everything
  // from the CJS version.
  assert.strictEqual(common.mustCall, mjs.mustCall);
  assert(!isModuleNamespaceObject(common));
  assert(isModuleNamespaceObject(mjs));
}
{
  const mod = require('../fixtures/es-module-loaders/module-named-exports.mjs');
  assert.deepStrictEqual({ ...mod }, { foo: 'foo', bar: 'bar' });
  assert(isModuleNamespaceObject(mod));
}

{
  const mod = require('../fixtures/source-map/esm-basic.mjs');
  assert.deepStrictEqual({ ...mod }, {});
  assert(isModuleNamespaceObject(mod));
}

{
  const mod = require('../fixtures/es-modules/cjs-exports.mjs');
  assert.deepStrictEqual({ ...mod }, {});
  assert(isModuleNamespaceObject(mod));
}

{
  const mod = require('../fixtures/es-modules/loose.js');
  assert.deepStrictEqual({ ...mod }, { default: 'module' });
  assert(isModuleNamespaceObject(mod));
}

{
  const mod = require('../fixtures/es-modules/package-without-type/noext-esm');
  assert.deepStrictEqual({ ...mod }, { default: 'module' });
  assert(isModuleNamespaceObject(mod));
}

assert.throws(() => {
  require('../fixtures/es-modules/es-note-unexpected-export-1.cjs');
}, {
  message: /Unexpected token 'export'/
});

assert.throws(() => {
  require('../fixtures/es-modules/tla/a.mjs');
}, {
  message: /require\(\) cannot be used on an ESM graph with top-level await\. Use import\(\) instead\./
});

// TODO(joyeecheung): test --require
// TODO(joyeecheung): test import() and import return the same thing
// TODO(joyeecheung): test "type" field
// TODO(joyeecheung): test "exports" field
