'use strict';

// This tests the TypeScript compiler in the snapshot.

const common = require('../common');

if (process.features.debug) {
  common.skip('V8 snapshot does not work with mutated globals yet: ' +
              'https://bugs.chromium.org/p/v8/issues/detail?id=12772');
}

const assert = require('assert');
const { spawnSync } = require('child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const path = require('path');
const fs = require('fs');

tmpdir.refresh();
const blobPath = path.join(tmpdir.path, 'snapshot.blob');
const file = fixtures.path('snapshot', 'typescript.js');

{
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    '--build-snapshot',
    file,
  ], {
    cwd: tmpdir.path
  });
  const stderr = child.stderr.toString();
  const stdout = child.stdout.toString();
  console.log(stderr);
  console.log(stdout);
  assert.strictEqual(child.status, 0);

  const stats = fs.statSync(path.join(tmpdir.path, 'snapshot.blob'));
  assert(stats.isFile());
}

{
  let child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    fixtures.path('snapshot', 'check-typescript.js'),
  ], {
    cwd: tmpdir.path,
    env: {
      ...process.env,
      NODE_TEST_USE_SNAPSHOT: 'true'
    }
  });
  let stderr = child.stderr.toString();
  const snapshotOutput = child.stdout.toString();
  console.log(stderr);
  console.log(snapshotOutput);

  assert.strictEqual(child.status, 0);
  assert(stderr.includes('NODE_TEST_USE_SNAPSHOT true'));

  child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    fixtures.path('snapshot', 'check-typescript.js'),
  ], {
    cwd: tmpdir.path,
    env: {
      ...process.env,
      NODE_TEST_USE_SNAPSHOT: 'false'
    }
  });
  stderr = child.stderr.toString();
  const verifyOutput = child.stdout.toString();
  console.log(stderr);
  console.log(verifyOutput);

  assert.strictEqual(child.status, 0);
  assert(stderr.includes('NODE_TEST_USE_SNAPSHOT false'));

  assert(snapshotOutput.includes(verifyOutput));
}
