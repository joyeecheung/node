'use strict';

// This tests state management scenarios for tls.setDefaultCACertificates()
// including certificate replacement, system cert integration, and multiple calls

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Test complete replacement behavior
{
  const originalDefaults = tls.getCACertificates('default');
  const bundledCerts = tls.getCACertificates('bundled');
  
  // Set custom certificates
  const customCerts = [fixtures.readKey('fake-startcom-root-cert.pem')];
  tls.setDefaultCACertificates(customCerts);
  
  // Verify complete replacement
  const newDefaults = tls.getCACertificates('default');
  assert.strictEqual(newDefaults.length, 1);
  assert.notDeepStrictEqual(newDefaults, originalDefaults);
  assert.notDeepStrictEqual(newDefaults, bundledCerts);
  assert.deepStrictEqual(newDefaults, customCerts);
}

// Test before/after comparison
{
  const beforeSetting = tls.getCACertificates('default');
  const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  tls.setDefaultCACertificates([fixtureCert]);
  
  const afterSetting = tls.getCACertificates('default');
  assert.notDeepStrictEqual(beforeSetting, afterSetting);
  assert.strictEqual(afterSetting.length, 1);
  assert.strictEqual(afterSetting[0], fixtureCert);
}

// Test system certs integration when available
{
  const systemCerts = tls.getCACertificates('system');
  if (systemCerts.length > 0) {
    // Set system certificates as default
    tls.setDefaultCACertificates(systemCerts);
    
    const newDefaults = tls.getCACertificates('default');
    assert.deepStrictEqual(newDefaults, systemCerts);
    
    // Verify system cert type still returns original system certs
    const stillSystemCerts = tls.getCACertificates('system');
    assert.deepStrictEqual(stillSystemCerts, systemCerts);
  }
}

// Test multiple calls with different certificate sets
{
  const fixtureCert1 = fixtures.readKey('fake-startcom-root-cert.pem');
  const bundledCerts = tls.getCACertificates('bundled');
  
  // First call
  tls.setDefaultCACertificates([fixtureCert1]);
  const after1 = tls.getCACertificates('default');
  assert.strictEqual(after1.length, 1);
  assert.strictEqual(after1[0], fixtureCert1);
  
  // Second call with bundled certs
  tls.setDefaultCACertificates(bundledCerts);
  const after2 = tls.getCACertificates('default');
  assert.deepStrictEqual(after2, bundledCerts);
  
  // Third call with empty array
  tls.setDefaultCACertificates([]);
  const after3 = tls.getCACertificates('default');
  assert.strictEqual(after3.length, 0);
}

// Test mixed valid/invalid certificates (should not throw during setting)
{
  const validCert = fixtures.readKey('fake-startcom-root-cert.pem');
  const invalidCert = 'invalid certificate string';
  
  // Should not throw during the call
  assert.doesNotThrow(() => {
    tls.setDefaultCACertificates([validCert, invalidCert]);
  });
  
  const result = tls.getCACertificates('default');
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0], validCert);
  assert.strictEqual(result[1], invalidCert);
}

// Test duplicate certificates
{
  const cert = fixtures.readKey('fake-startcom-root-cert.pem');
  const duplicateCerts = [cert, cert, cert];
  
  tls.setDefaultCACertificates(duplicateCerts);
  
  const result = tls.getCACertificates('default');
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0], cert);
  assert.strictEqual(result[1], cert);
  assert.strictEqual(result[2], cert);
}