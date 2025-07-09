'use strict';

// Flags: --no-use-system-ca
// This tests input validation and error handling for tls.setDefaultCACertificates()

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const assert = require('assert');
const tls = require('tls');

const defaultCerts = tls.getCACertificates('default').sort();
const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');

for (const invalid of [null, undefined, 'string', 42, {}, true]) {

  // Test input validation - should throw when not passed an array
  assert.throws(() => tls.setDefaultCACertificates(invalid), {
    code: 'ERR_INVALID_ARG_TYPE',
    message: /The "certs" argument must be an instance of Array/
  });
  // Verify that default certificates remain unchanged after error.
  assert.deepStrictEqual(tls.getCACertificates('default').sort(), defaultCerts);

  // Test input validation - should throw when passed an array with invalid elements
  assert.throws(() => tls.setDefaultCACertificates([invalid]), {
    code: 'ERR_INVALID_ARG_TYPE',
    message: /The "certs" argument must be an instance of Array/
  });
  // Verify that default certificates remain unchanged after error.
  assert.deepStrictEqual(tls.getCACertificates('default').sort(), defaultCerts);

  assert.throws(() => tls.setDefaultCACertificates([fixtureCert, invalid]), {
    code: 'ERR_INVALID_ARG_TYPE',
    message: /The "certs\[1\]" argument must be one of type string or ArrayBufferView/
  });
  // Verify that default certificates remain unchanged after error.
  assert.deepStrictEqual(tls.getCACertificates('default').sort(), defaultCerts);
}
