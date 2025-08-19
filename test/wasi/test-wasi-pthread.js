'use strict';

// Tests test/wasi/wasm/pthread.wasm, see test/wasi/c/pthread.c
const common = require('../common');
const run = require('../fixtures/wasm32-wasip1-threads.js');

run('pthread').then(common.mustCall());
