'use strict';

const zlib = require('zlib');
const fs = require('fs');
const assert = require('assert');

const fixture = process.env.NODE_TEST_FIXTURE;
const mode = process.env.NODE_TEST_MODE;
const gunzip = zlib.createGunzip();
const inp = fs.createReadStream(fixture);

inp.pipe(gunzip);

let data = [];
gunzip.on('data', (d) => {
  console.log(`Pushing ${gunzip.bytesWritten} bytes into the `+
              `#${data.length} chunk`);
  data.push(d);
});
gunzip.on('end', (d) => {
  const result = Buffer.concat(data);
  console.log(`Result length = ${result.byteLength}`);
  console.log('NODE_TEST_MODE:', mode);
  if (mode === 'snapshot') {
    globalThis.NODE_TEST_DATA = result;
  } else if (mode === 'verify') {
    assert.deepStrictEqual(globalThis.NODE_TEST_DATA, result);
  } else {
    assert.fail('Unknown mode');
  }
});
