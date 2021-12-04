'use strict';

// Flags: --expose-internals
// This tests that internal modules are not leaked into snapshot scripts.

const common = require('../common');
if (!common.isMainThread) {
  common.skip('Cannot test --expose-internals from worker');
}
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// In this test process, builtinModules should include all the
// intenral modules.
const { builtinModules } = require('module');

const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const assert = require('assert');

tmpdir.refresh();
const file = fixtures.path('snapshot', 'require.js');

const internalModules =
  builtinModules.filter((id) => id.startsWith('internal/'));
assert(internalModules.length > 0);
fs.writeFileSync(
  path.join(tmpdir.path, 'modules.json'),
  JSON.stringify(internalModules), 'utf-8'
);

const child = spawnSync(process.execPath, [
  '--build-snapshot',
  file,
], {
  env: {
    ...process.env,
  },
  cwd: tmpdir.path
});

if (child.status !== 0) {
  console.log(child.stderr.toString());
  console.log(child.stdout.toString());
  assert.strictEqual(child.status, 0);
}

const loaded = require(path.join(tmpdir.path, 'loaded.json'));
const errored = require(path.join(tmpdir.path, 'errored.json'));

assert.deepStrictEqual(new Set(loaded), new Set());
assert.deepStrictEqual(new Set(errored), new Set(internalModules));
