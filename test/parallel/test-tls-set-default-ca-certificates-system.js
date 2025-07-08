'use strict';

// This tests tls.setDefaultCACertificates() with system certificates

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const { assertIsCAArray } = require('../common/tls');

// Test setting system certificates as default
{
  const systemCerts = tls.getCACertificates('system');
  if (systemCerts.length > 0) {
    assertIsCAArray(systemCerts);
    
    // Set system certificates as default
    tls.setDefaultCACertificates(systemCerts);
    
    const newDefaults = tls.getCACertificates();
    assert.deepStrictEqual(newDefaults, systemCerts);
    assert.strictEqual(newDefaults.length, systemCerts.length);
  }
}

// Test combining system and bundled certificates
{
  const systemCerts = tls.getCACertificates('system');
  const bundledCerts = tls.getCACertificates('bundled');
  
  if (systemCerts.length > 0) {
    // Combine system and bundled certificates
    const combinedCerts = [...systemCerts, ...bundledCerts];
    tls.setDefaultCACertificates(combinedCerts);
    
    const result = tls.getCACertificates();
    assert.strictEqual(result.length, combinedCerts.length);
    assert.deepStrictEqual(result, combinedCerts);
  }
}

// Test that getCACertificates('default') returns user-set certificates
{
  const bundledCerts = tls.getCACertificates('bundled');
  const subset = bundledCerts.slice(0, 3);
  
  tls.setDefaultCACertificates(subset);
  
  const defaultCerts = tls.getCACertificates('default');
  const implicitDefaults = tls.getCACertificates();
  
  assert.deepStrictEqual(defaultCerts, implicitDefaults);
  assert.strictEqual(defaultCerts.length, 3);
  assert.deepStrictEqual(defaultCerts, subset);
}