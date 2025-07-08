'use strict';

// This tests that tls.setDefaultCACertificates() changes don't affect other certificate types

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Test that setting default certificates doesn't affect other types
{
  const originalBundled = tls.getCACertificates('bundled');
  const originalSystem = tls.getCACertificates('system');
  
  // Set new default certificates
  const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');
  tls.setDefaultCACertificates([fixtureCert]);
  
  // Verify that other certificate types are unchanged
  const newBundled = tls.getCACertificates('bundled');
  const newSystem = tls.getCACertificates('system');
  
  assert.strictEqual(newBundled, originalBundled);
  assert.strictEqual(newSystem, originalSystem);
  
  // Verify that only default changed
  const newDefault = tls.getCACertificates('default');
  assert.strictEqual(newDefault.length, 1);
  assert.strictEqual(newDefault[0], fixtureCert);
}

// Test that rootCertificates property is unaffected
{
  const originalRootCerts = tls.rootCertificates;
  
  // Set new default certificates
  const bundledCerts = tls.getCACertificates('bundled');
  const subset = bundledCerts.slice(0, 5);
  tls.setDefaultCACertificates(subset);
  
  // Verify rootCertificates is unchanged
  const newRootCerts = tls.rootCertificates;
  assert.strictEqual(newRootCerts, originalRootCerts);
}

// Test that multiple calls with different certificate sources work correctly
{
  const bundledCerts = tls.getCACertificates('bundled');
  const systemCerts = tls.getCACertificates('system');
  const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Set to bundled
  tls.setDefaultCACertificates(bundledCerts);
  assert.strictEqual(tls.getCACertificates().length, bundledCerts.length);
  
  // Set to system (if available)
  if (systemCerts.length > 0) {
    tls.setDefaultCACertificates(systemCerts);
    assert.strictEqual(tls.getCACertificates().length, systemCerts.length);
  }
  
  // Set to fixture
  tls.setDefaultCACertificates([fixtureCert]);
  assert.strictEqual(tls.getCACertificates().length, 1);
  assert.strictEqual(tls.getCACertificates()[0], fixtureCert);
  
  // Verify other types remain unchanged
  assert.strictEqual(tls.getCACertificates('bundled'), bundledCerts);
  if (systemCerts.length > 0) {
    assert.strictEqual(tls.getCACertificates('system'), systemCerts);
  }
}

// Test appending to existing certificates (as shown in documentation)
{
  const currentCerts = tls.getCACertificates('bundled');
  const additionalCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Append additional certificate to current defaults
  tls.setDefaultCACertificates([...currentCerts, additionalCert]);
  
  const result = tls.getCACertificates();
  assert.strictEqual(result.length, currentCerts.length + 1);
  assert.strictEqual(result[result.length - 1], additionalCert);
  
  // Verify the original certificates are still there
  for (let i = 0; i < currentCerts.length; i++) {
    assert.strictEqual(result[i], currentCerts[i]);
  }
}