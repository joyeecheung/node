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

function test(input) {
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
test(input);
test(input.toString());
