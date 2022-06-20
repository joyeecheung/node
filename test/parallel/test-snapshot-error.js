'use strict';

// This tests that the errors in the snapshot script can be handled
// properly.

require('../common');
const assert = require('assert');
const { spawnSync } = require('child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const path = require('path');
const fs = require('fs');

tmpdir.refresh();
const blobPath = path.join(tmpdir.path, 'snapshot.blob');
const entry = fixtures.path('snapshot', 'error.js');
{
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    blobPath,
    '--build-snapshot',
    entry,
  ], {
    cwd: tmpdir.path
  });
  const stderr = child.stderr.toString();
  console.log(child.status);
  console.log(stderr);
  console.log(child.stdout.toString());
  assert.strictEqual(child.status, 1);
  assert.match(stderr, /error\.js:1/);
  assert(!fs.existsSync(path.join(tmpdir.path, 'snapshot.blob')));
}
