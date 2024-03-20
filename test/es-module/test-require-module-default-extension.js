// Flags: --experimental-require-module
'use strict';

const { expectNamespace } = require('../common');
const assert = require('assert');

const mod = require('../fixtures/es-modules/package-default-extension/index.mjs');
expectNamespace(mod, { entry: 'mjs' });

assert.throws(() => {
  const mod = require('../fixtures/es-modules/package-default-extension');
  console.log(mod);  // In case it succeeds, log the result for debugging.
}, {
  code: 'MODULE_NOT_FOUND',
});
