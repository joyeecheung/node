'use strict';

// This tests caching behavior of tls.setDefaultCACertificates()

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Test that cache is properly invalidated when certificates are set
{
  const bundledCerts = tls.getCACertificates('bundled');
  
  // Get initial defaults (should be cached)
  const initialDefaults = tls.getCACertificates();
  const initialDefaults2 = tls.getCACertificates();
  assert.strictEqual(initialDefaults, initialDefaults2); // Should be same reference
  
  // Set new certificates
  const subset = bundledCerts.slice(0, 5);
  tls.setDefaultCACertificates(subset);
  
  // Get new defaults (cache should be invalidated)
  const newDefaults = tls.getCACertificates();
  const newDefaults2 = tls.getCACertificates();
  
  assert.notStrictEqual(newDefaults, initialDefaults); // Should be different reference
  assert.strictEqual(newDefaults, newDefaults2); // Should be same reference (cached)
  assert.strictEqual(newDefaults.length, 5);
}

// Test multiple consecutive calls to setDefaultCACertificates
{
  const bundledCerts = tls.getCACertificates('bundled');
  const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Set first batch
  const firstBatch = bundledCerts.slice(0, 3);
  tls.setDefaultCACertificates(firstBatch);
  const firstResult = tls.getCACertificates();
  assert.strictEqual(firstResult.length, 3);
  
  // Set second batch
  const secondBatch = [fixtureCert];
  tls.setDefaultCACertificates(secondBatch);
  const secondResult = tls.getCACertificates();
  assert.strictEqual(secondResult.length, 1);
  assert.strictEqual(secondResult[0], fixtureCert);
  
  // Set third batch (empty)
  tls.setDefaultCACertificates([]);
  const thirdResult = tls.getCACertificates();
  assert.strictEqual(thirdResult.length, 0);
  
  // Set fourth batch (back to bundled)
  tls.setDefaultCACertificates(bundledCerts);
  const fourthResult = tls.getCACertificates();
  assert.strictEqual(fourthResult.length, bundledCerts.length);
  assert.deepStrictEqual(fourthResult, bundledCerts);
}

// Test that 'default' type parameter works after setting certificates
{
  const bundledCerts = tls.getCACertificates('bundled');
  const subset = bundledCerts.slice(0, 7);
  
  tls.setDefaultCACertificates(subset);
  
  const defaultType = tls.getCACertificates('default');
  const implicitDefault = tls.getCACertificates();
  
  assert.strictEqual(defaultType, implicitDefault);
  assert.strictEqual(defaultType.length, 7);
}