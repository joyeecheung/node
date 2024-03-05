// Flags: --experimental-require-module
'use strict';

require('../common');
const assert = require('assert');
const { spawnSyncAndExit } = require('../common/child_process');
const fixtures = require('../common/fixtures');

const message = /require\(\) cannot be used on an ESM graph with top-level await/;
// TODO(joyeecheung): assign a code for this error.
assert.throws(() => {
  require('../fixtures/es-modules/tla/rejected.mjs');
}, { message });

assert.throws(() => {
  require('../fixtures/es-modules/tla/unresolved.mjs');
}, { message });


assert.throws(() => {
  require('../fixtures/es-modules/tla/resolved.mjs');
}, { message });

// Test TLA in inner graphs.
assert.throws(() => {
  require('../fixtures/es-modules/tla/parent.mjs');
}, { message });

{
  spawnSyncAndExit(process.execPath, [
    '--experimental-require-module',
    fixtures.path('es-modules/tla/require-execution.js'),
  ], {
    signal: null,
    status: 1,
    stderr(output) {
      assert.doesNotMatch(output, /I am executed/);
      assert.match(output, message);
      return true;
    },
    stdout: ''
  });
}

{
  spawnSyncAndExit(process.execPath, [
    '--experimental-require-module',
    '--experimental-print-required-tla',
    fixtures.path('es-modules/tla/require-execution.js'),
  ], {
    signal: null,
    status: 1,
    stderr(output) {
      assert.match(output, /I am executed/);
      assert.match(output, /Error: unexpected top-level await at.*execution\.mjs:3/);
      assert.match(output, /await Promise\.resolve\('hi'\)/);
      assert.match(output, message);
      return true;
    },
    stdout: ''
  });
}
