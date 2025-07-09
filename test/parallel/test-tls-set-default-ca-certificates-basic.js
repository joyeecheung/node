// Flags: --no-use-system-ca

// This tests the basic functionality of tls.setDefaultCACertificates().
'use strict';

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const originalBundled = tls.getCACertificates('bundled').sort();
const originalSystem = tls.getCACertificates('system').sort();
const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');

function testSetCertificates(certs) {
  // Test setting it can be verified with tls.getCACertificates().
  tls.setDefaultCACertificates(certs);
  const result = tls.getCACertificates('default').sort();
  assert.deepStrictEqual(result, certs.sort());

  // Verify that other certificate types are unchanged
  const newBundled = tls.getCACertificates('bundled').sort();
  const newSystem = tls.getCACertificates('system').sort();
  assert.deepStrictEqual(newBundled, originalBundled);
  assert.deepStrictEqual(newSystem, originalSystem);

  // Test implicit defaults.
  const implicitDefaults = tls.getCACertificates().sort();
  assert.deepStrictEqual(implicitDefaults, certs.sort());

  // Test cached results.
  const cachedResult = tls.getCACertificates('default').sort();
  assert.deepStrictEqual(cachedResult, certs.sort());
  const cachedImplicitDefaults = tls.getCACertificates().sort();
  assert.deepStrictEqual(cachedImplicitDefaults, certs.sort());
}

// Test setting with fixture certificate.
testSetCertificates([fixtureCert]);

// Test setting with empty array.
testSetCertificates([]);

// Test setting with bundled certificates
testSetCertificates(originalBundled);

// Test combining bundled and extra certificates.
testSetCertificates([...originalBundled, fixtureCert].sort());

// Test setting with a subset of bundled certificates
if (originalBundled.length >= 3) {
  testSetCertificates(originalBundled.slice(0, 3));
}

// Test setting with system certificates
if (originalSystem.length > 0) {
  testSetCertificates(originalSystem);
}

// Test duplicate certificates
tls.setDefaultCACertificates([fixtureCert, fixtureCert, fixtureCert]);
assert.deepStrictEqual(tls.getCACertificates('default'), [fixtureCert]);
