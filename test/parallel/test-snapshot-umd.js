'use strict';

// This tests the behavior of loading a UMD module with --snapshot-main

require('../common');
const assert = require('assert');
const { spawnSync } = require('child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const path = require('path');
const fs = require('fs');

tmpdir.refresh();
const file = fixtures.path('snapshot', 'marked.js');

{
  // By default, the snapshot blob path is snapshot.blob at cwd
  const child = spawnSync(process.execPath, [
    '--snapshot-main',
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

const md = `
# heading

[link][1]

[1]: #heading "heading"
`;

{
  const child = spawnSync(process.execPath, [
    '--snapshot-blob',
    path.join(tmpdir.path, 'snapshot.blob'),
    fixtures.path('snapshot', 'check-umd.js'),
  ], {
    cwd: tmpdir.path
  });
  const stderr = child.stderr.toString();
  const stdout = child.stdout.toString();
  console.log(stderr);
  console.log(stdout);
  assert.strictEqual(child.status, 0);
  const marked = require(file);
  assert(stdout.includes(marked(md)));
}
