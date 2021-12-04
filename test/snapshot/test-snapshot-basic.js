'use strict';

// This tests the basic functionality of --build-snapshot.

require('../common');
const assert = require('assert');
const { spawnSync } = require('child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const path = require('path');
const fs = require('fs');

tmpdir.refresh();
const file = fixtures.path('snapshot', 'mutate-fs.js');

{
  // By default, the snapshot blob path is snapshot.blob at cwd
  const child = spawnSync(process.execPath, [
    '--build-snapshot',
    file,
  ], {
    cwd: tmpdir.path
  });
  if (child.status !== 0) {
    console.log(child.stderr.toString());
    console.log(child.stdout.toString());
    assert.strictEqual(child.status, 0);
  }
  const stats = fs.statSync(path.join(tmpdir.path, 'snapshot.blob'));
  assert(stats.isFile());
}

{
  // --snapshot-blob should work with --build-snapshot.
  const blobPath = path.join(tmpdir.path, 'my-snapshot.blob');
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    '--build-snapshot',
    file,
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
  // Running --build-snapshot without an entry point should fail.
  tmpdir.refresh();
  const child = spawnSync(process.execPath, [
    '--build-snapshot',
  ], {
    cwd: tmpdir.path
  });

  assert.match(
    child.stderr.toString(),
    /--build-snapshot only supports starting/);  // Start of the message.
  assert.strictEqual(child.status, 1);
  assert(!fs.existsSync(path.join(tmpdir.path, 'snapshot.blob')));
}

// Loading non-existent blob should fail.
{
  tmpdir.refresh();
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    'non-existent.blob',
  ], {
    cwd: tmpdir.path
  });

  assert.match(
    child.stderr.toString(),
    /Cannot open non-existent\.blob/);
  assert.strictEqual(child.status, 1);
  assert(!fs.existsSync(path.join(tmpdir.path, 'snapshot.blob')));
}

// If the snapshot script throws, it should fail too.
{
  tmpdir.refresh();
  const child = spawnSync(process.execPath, [
    '--build-snapshot',
    fixtures.path('snapshot', 'error.js'),
  ], {
    cwd: tmpdir.path
  });

  const stderr = child.stderr.toString();

  assert.match(
    stderr,
    /throw new Error/);
  assert.match(
    stderr,
    /error\.js:1:7/);
  assert.strictEqual(child.status, 1);
  assert(!fs.existsSync(path.join(tmpdir.path, 'snapshot.blob')));
}
