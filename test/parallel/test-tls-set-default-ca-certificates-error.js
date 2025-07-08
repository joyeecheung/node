'use strict';

// This tests input validation and error handling for tls.setDefaultCACertificates()

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');

// Test input validation - should throw when not passed an array
{
  for (const invalid of [null, undefined, 'string', 42, {}, true]) {
    assert.throws(() => tls.setDefaultCACertificates(invalid), {
      code: 'ERR_INVALID_ARG_TYPE',
      message: /The "certs" argument must be an instance of Array/
    });
  }
}

// Test array element validation - should throw when array contains invalid elements
{
  for (const invalid of [null, undefined, 42, {}, true, []]) {
    assert.throws(() => tls.setDefaultCACertificates(['valid cert', invalid]), {
      code: 'ERR_INVALID_ARG_TYPE',
      message: /The "certs\[1\]" argument must be one of type string or ArrayBufferView/
    });
  }
}

// Test with invalid certificate format
{
  const invalidCert = 'not a valid certificate';
  // This should not throw during the call, but would fail during actual TLS usage
  assert.doesNotThrow(() => tls.setDefaultCACertificates([invalidCert]));
}

// Test with mixed valid and invalid certificate formats
{
  const validCert = '-----BEGIN CERTIFICATE-----\nvalid cert content\n-----END CERTIFICATE-----';
  const invalidCert = 'invalid cert';
  // Should not throw during the call
  assert.doesNotThrow(() => tls.setDefaultCACertificates([validCert, invalidCert]));
}