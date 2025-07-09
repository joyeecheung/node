'use strict';

// Flags: --no-use-system-ca
// This tests error recovery and fallback behavior for tls.setDefaultCACertificates()

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');

// Test with invalid certificate format.
function testRecovery(expectedCerts) {
  {
    const invalidCert = 'not a valid certificate';
    assert.throws(() => tls.setDefaultCACertificates([invalidCert]), {
      code: 'ERR_INVALID_ARG_TYPE',
      message: /The "certs\[1\]" argument must be one of type string or ArrayBufferView/
    });
    assert.deepStrictEqual(tls.getCACertificates('default').sort(), expectedCerts);
  }

  // Test with mixed valid and invalid certificate formats.
  {
    const invalidCert = '-----BEGIN CERTIFICATE-----\nvalid cert content\n-----END CERTIFICATE-----';
    assert.throws(() => tls.setDefaultCACertificates([fixtureCert, invalidCert]), {
      code: 'ERR_INVALID_ARG_TYPE',
      message: /The "certs\[1\]" argument must be one of type string or ArrayBufferView/
    });
    assert.deepStrictEqual(tls.getCACertificates('default').sort(), expectedCerts);
  }
}

const originalDefaultCerts = tls.getCACertificates('default').sort();
testRecovery(originalDefaultCerts);

// Check that recovery still works after replacing the default certificates.
const subset = tls.getCACertificates('bundled').slice(0, 3).sort();
tls.setDefaultCACertificates(subset);
assert.deepStrictEqual(tls.getCACertificates('default').sort());
testRecovery(subset);
