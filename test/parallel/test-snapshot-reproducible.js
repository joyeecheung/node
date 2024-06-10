'use strict';

require('../common');
const { spawnSyncAndAssert } = require('../common/child_process');
const tmpdir = require('../common/tmpdir');
const fs = require('fs');
const assert = require('assert');
const fixtures = require('../common/fixtures');

function log(line, name) {
  fs.writeFileSync(name + '.txt', line + '\n', { flag: 'a' });
}

let i = 0;
function getName() {
  return 'abcdefg'[i++];
}

function generateSnapshot(name = getName()) {
  tmpdir.refresh();

  spawnSyncAndAssert(
    process.execPath,
    [
      '--random_seed=42',
      '--serialization-statistics',
      '--predictable',
      '--build-snapshot',
      'node:generate_default_snapshot',
    ],
    {
      cwd: tmpdir.path
    },
    {
      stdout(output) {
        const lines = output.split('\n');
        let blobStatStarted = false;
        let blobStatEnded = false;
        for (const line of lines) {
          if (/snapshot blob start at/.test(line)) {
            console.log(line, name);
            continue;
          }
          if (/SnapshotByteSink/.test(line)) {
            log(line, name);
            continue;
          }
          if (/Snapshot blob consists of/.test(line)) {
            blobStatStarted = true;
            continue;
          }
          if (/Snapshot blob statistics end/.test(line)) {
            blobStatEnded = true;
            continue;
          }
          if (blobStatStarted && !blobStatEnded) {
            log(line, name);
          }
        }
        return true;
      }
    }
  );
  const blobPath = tmpdir.resolve('snapshot.blob');
  return fs.readFileSync(blobPath);
}

const buf1 = generateSnapshot();
const buf2 = generateSnapshot();
console.log(buf1.length.toString(16));
console.log(buf2.length.toString(16));

const diff = [];
let offset = 0;
const step = 16;
do {
  const length = Math.min(buf1.length - offset, step);
  const slice1 = buf1.slice(offset, offset + length).toString('hex');
  const slice2 = buf2.slice(offset, offset + length).toString('hex');
  if (slice1 != slice2) {
    diff.push({offset: '0x' + (offset).toString(16), slice1, slice2});
  }
  offset += length;
} while (offset < buf1.length);

assert.strictEqual(offset, buf1.length);
if (offset < buf2.length) {
  const length = Math.min(buf2.length - offset, step);
  const slice2 = buf2.slice(offset, offset + length).toString('hex');
  diff.push({offset, slice1: '', slice2});
  offset += length;
} while (offset < buf2.length);

assert.deepStrictEqual(diff, [], 'Built-in snapshot should not change in different builds.');
assert.strictEqual(buf1.length, buf2.length);
