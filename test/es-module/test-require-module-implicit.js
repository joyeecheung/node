// Flags: --experimental-require-module
'use strict';

// Tests that require()ing modules without explicit module type information
// warns and errors.
const common = require('../common');
const assert = require('assert');

common.expectWarning(
  'Warning',
  'To load an ES module:\n' +
  '- Either the nearest package.json should set "type":"module", ' +
  'or the module should use the .mjs extension.\n' +
  '- If it\'s loaded using require(), use --experimental-require-module'
);
common.expectWarning(
  'ExperimentalWarning',
  'Support for loading ES Module in require() is an experimental feature ' +
  'and might change at any time'
);

assert.throws(() => {
  require('../fixtures/es-modules/package-without-type/noext-esm');
}, {
  message: /Unexpected token 'export'/
});

assert.throws(() => {
  require('../fixtures/es-modules/loose.js');
}, {
  message: /Unexpected token 'export'/
});
