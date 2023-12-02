'use strict';

const common = require('../common.js');
const assert = require('assert');

const bench = common.createBenchmark(main, {
  n: [1000000],
  method: ['ExampleCppgcObject', 'ExampleBaseObject'],
});

function main({ n, method }) {
  const {
    ExampleBaseObject, ExampleCppgcObject,
  } = common.binding('example_object');

  const array = [];
  for (let i = 0; i < n; ++i) {
    array.push(null);
  }

  switch (method) {
    case 'ExampleCppgcObject': {
      bench.start();
      for (let i = 0; i < n; ++i) {
        array[i] = new ExampleCppgcObject();
      }
      bench.end(n);
      break;
    }
    case 'ExampleBaseObject': {
      bench.start();
      for (let i = 0; i < n; ++i) {
        array[i] = new ExampleBaseObject();
      }
      bench.end(n);
      break;
    }
    default:
      throw new Error(`Unexpected method "${method}"`);
  }
  assert.strictEqual(typeof array[n - 1], 'object');
}
