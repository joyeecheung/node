// Flags: --experimental-require-module
'use strict';

// Tests that require()ing modules without explicit module type information
// warns and errors.
require('../common');
const assert = require('assert');

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
