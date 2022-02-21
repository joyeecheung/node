'use strict';

// This tests that user land snapshots works when the instance restored from
// the snapshot is launched with --help, --check

const common = require('../common');
const signals = require('os').constants.signals;
const assert = require('assert');
const { spawnSync } = require('child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const path = require('path');
const fs = require('fs');

tmpdir.refresh();
const blobPath = path.join(tmpdir.path, 'snapshot.blob');
const file = fixtures.path('snapshot', 'mem-bug.js');
const empty = fixtures.path('empty.js');

{
  // Create the snapshot.
  const child = spawnSync(process.execPath, [
    '--snapshot-main',
    file,
    '--snapshot-blob',
    blobPath,
  ], {
    cwd: tmpdir.path
  });
  if (child.status !== 0) {
    console.log(child.stderr.toString());
    console.log(child.stdout.toString());
    assert.strictEqual(child.status, 0);
  }
  const stats = fs.statSync(blobPath);
  assert(stats.isFile());
}

{
  // Check snapshot
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    empty,
  ], {
    cwd: tmpdir.path
  });

  if (child.status !== 0) {
    console.log(child.stderr.toString());
    console.log(child.stdout.toString());
    if (!common.isWindows)
      console.log('Signal', child.signal);
    assert.strictEqual(child.status, 0);
  }
}
