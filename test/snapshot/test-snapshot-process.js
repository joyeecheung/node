'use strict';

// This tests that user land snapshots works when the instance restored from
// the snapshot is launched with --help, --check

require('../common');
const assert = require('assert');
const { spawnSync } = require('child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const path = require('path');
const fs = require('fs');

const blobPath = path.join(tmpdir.path, 'my-snapshot.blob');
const file = fixtures.path('snapshot', 'process.js');
{
  // Check that process.env is available during snapshot building.
  tmpdir.refresh();
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    '--build-snapshot',
    file,
    'test',
  ], {
    env: {
      NODE_TEST: 'TEST'
    },
    cwd: tmpdir.path
  });
  const stdout = child.stdout.toString();
  if (child.status !== 0) {
    console.log(child.stderr.toString());
    console.log(stdout.toString());
    assert.strictEqual(child.status, 0);
  }
  const stats = fs.statSync(blobPath);
  assert(stats.isFile());

  const output = JSON.parse(stdout);
  assert.strictEqual(output.env.NODE_TEST, 'TEST');
  assert.deepStrictEqual(output.argv, [
    process.execPath,
    file,
    'test',
  ]);
  assert.strictEqual(output.execPath, process.execPath);
  assert.deepStrictEqual(output.execArgv, [
    '--snapshot-blob',
    blobPath,
    '--build-snapshot',
  ]);
  assert.strictEqual(output.pid, child.pid);
}

{
  // Check that process.env is refreshed when the snapshot is deserialized.
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    file,
    'run',
  ], {
    env: {
      NODE_TEST: 'RUN'
    },
    cwd: tmpdir.path
  });

  if (child.status !== 0) {
    console.log(child.stderr.toString());
    console.log(child.stdout.toString());
    assert.strictEqual(child.status, 0);
  }

  const stdout = child.stdout.toString();
  const output = JSON.parse(stdout);
  assert.strictEqual(output.env.NODE_TEST, 'RUN');
  assert.deepStrictEqual(output.argv, [
    process.execPath,
    file,
    'run',
  ]);
  assert.strictEqual(output.execPath, process.execPath);
  assert.deepStrictEqual(output.execArgv, [
    '--snapshot-blob',
    blobPath,
  ]);
  assert.strictEqual(output.pid, child.pid);
}
