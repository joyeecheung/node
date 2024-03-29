'use strict';

const common = require('../common.js');
const v8 = require('v8');
const assert = require('assert');
const { isUint8Array } = require('util/types');

const bench = common.createBenchmark(main, {
  type: ['array', 'typed-array', 'bigint-typed-array'],
  len: [16, 256, 1024],
  n: [1e4],
});

function main({ n, len, type }) {
  let arr;
  switch (type) {
    case 'array': {
      arr = [];
      for (let i = 0; i < len; ++i) {
        arr.push(Math.random());
      }
      break;
    }
    case 'typed-array': {
      arr = new Uint8Array(len);
      for (let i = 0; i < len; ++i) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      break;
    }
    case 'bigint-typed-array': {
      arr = new BigUint64Array(len);
      for (let i = 0; i < len; ++i) {
        arr[i] = BigInt(Math.floor(Math.random() * 1000 * 1000));
      }
      break;
    }
  }
  let input = v8.serialize(arr);
  let result;
  bench.start();
  for (let i = 0; i < n; i++) {
    result = v8.deserialize(input);
  }
  bench.end(n);
  assert.strictEqual(result.length, len);
}
