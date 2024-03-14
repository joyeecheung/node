// Flags: --experimental-require-module
'use strict';

require('../common');
const assert = require('assert');

assert.throws(() => {
  require('../fixtures/es-modules/network-import.mjs');
}, {
  code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME'
});
