'use strict';

const common = require('../common');
const path = require('path');
const { fork, spawn, execFileSync } = require('child_process');
const runBenchmark = require('../common/benchmark');
const assert = require('assert');

try {
  require('./benchmark/misc/function_call/build/Release/binding');
} catch (err) {
  const gyp = path.join(common.projectDir,
    ...('deps/npm/node_modules/node-gyp/bin/node-gyp.js'.split('/')));
  const dir = path.join(common.projectDir,
    'benchmark', 'misc', 'function_call');
  const args = [
    gyp,
    'rebuild',
    '--nodedir',
    common.projectDir,
    '--directory',
    dir,
    '--python',
    process.env.PYTHON || 'python'
  ];

  execFileSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env
  });
}

runBenchmark('misc', [
  'concat=0',
  'method=',
  'millions=.000001',
  'n=1',
  'type=extend',
  'val=magyarország.icom.museum'
]);
