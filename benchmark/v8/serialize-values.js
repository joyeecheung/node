'use strict';

const common = require('../common.js');
const v8 = require('v8');
const assert = require('assert');
const { isUint8Array } = require('util/types');
const fs = require('fs');
const path = require('path');

const bench = common.createBenchmark(main, {
  type: ['string', 'object'],
  n: [1e5],
});

function main({ n, type }) {
  const filepath = path.resolve(__dirname, '../../deps/npm/package.json');
  const str = fs.readFileSync(filepath, 'utf8');
  let input;
  switch (type) {
    case 'string': {
      input = str;
      break;
    }
    case 'object': {
      input = JSON.parse(str);
      break;
    }
  }
  let result;
  bench.start();
  for (let i = 0; i < n; i++) {
    result = v8.serialize(input);
  }
  bench.end(n);
  assert(isUint8Array(result));
}
