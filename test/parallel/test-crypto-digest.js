'use strict';
const common = require('../common');

if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');
const crypto = require('crypto');
const fixtures = require('../common/fixtures');
const fs = require('fs');

const methods = crypto.getHashes();
assert(methods.length > 0);

function testOneShot(input) {
  for (const method of methods) {
    for (const outputEncoding of [ 'buffer', 'hex', 'base64', undefined]) {
      const oldDigest = crypto.createHash(method).update(input).digest(outputEncoding);
      const newDigest = crypto.digest(method, input, { outputEncoding });
      assert.deepStrictEqual(newDigest, oldDigest,
                             `different result from ${method} with encoding ${outputEncoding}`);
    }
  }
}

const input = fs.readFileSync(fixtures.path('utf8_test_text.txt'));
testOneShot(input);
testOneShot(input.toString());

{
  const inputs = input.toString().split('，');
  for (const method of methods) {
    for (const outputEncoding of [ 'buffer', 'hex', 'base64', undefined]) {
      const buffered = crypto.createHash(method);
      const unbuffered = crypto.createHash(method, { disableBuffering: true });
      for (const data of inputs) {
        buffered.update(data);
        unbuffered.update(data);
      }
      const bufferedDigest = buffered.digest(outputEncoding);
      const unbufferedDigest = unbuffered.digest(outputEncoding);
      const newDigest = crypto.digest(method, inputs.join(''), { outputEncoding });
      assert.deepStrictEqual(unbufferedDigest, newDigest,
                             `unbuffered and one-shot ${method} digest differ with encoding ${outputEncoding}`);
      assert.deepStrictEqual(bufferedDigest, unbufferedDigest,
                             `buffered and unbuffered ${method} digest differ with encoding ${outputEncoding}`);
    }
  }
}
