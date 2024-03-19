// Flags: --experimental-require-module
'use strict';

require('../common');
const assert = require('assert');

const message = /require\(\) cannot be used on an ESM graph with top-level await/;
const code = 'ERR_REQUIRE_ASYNC_MODULE';

assert.throws(() => {
  require('../fixtures/es-modules/tla/resolved.mjs');
}, { message, code });

(async () => {
  await import('../fixtures/es-modules/tla/resolved.mjs');

  assert.throws(() => {
    require('../fixtures/es-modules/tla/resolved.mjs');
  }, { message, code });
})();
