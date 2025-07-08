'use strict';

// This tests the basic functionality of tls.setDefaultCACertificates()
// including certificate setting behavior and ArrayBufferView support.

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');
const { assertIsCAArray } = require('../common/tls');

// Test basic functionality
{
  const originalCerts = tls.getCACertificates();
  assertIsCAArray(originalCerts);

  // Test setting with bundled certificates
  const bundledCerts = tls.getCACertificates('bundled');
  tls.setDefaultCACertificates(bundledCerts);
  
  const newDefaults = tls.getCACertificates();
  assert.deepStrictEqual(newDefaults, bundledCerts);
  
  // Test setting with empty array
  tls.setDefaultCACertificates([]);
  const emptyCerts = tls.getCACertificates();
  assert.deepStrictEqual(emptyCerts, []);
  
  // Test setting with fixture certificate
  const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');
  tls.setDefaultCACertificates([fixtureCert]);
  const fixtureResult = tls.getCACertificates();
  assert.strictEqual(fixtureResult.length, 1);
  assert.strictEqual(fixtureResult[0], fixtureCert);
  
  // Test setting with a subset of certificates
  const subset = bundledCerts.slice(0, 5);
  tls.setDefaultCACertificates(subset);
  const subsetResult = tls.getCACertificates();
  assert.strictEqual(subsetResult.length, subset.length);
  assert.deepStrictEqual(subsetResult, subset);
}

// Test with ArrayBufferView inputs
{
  const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');
  const bufferCert = Buffer.from(fixtureCert, 'utf8');
  
  // Should accept Buffer (which is an ArrayBufferView)
  tls.setDefaultCACertificates([bufferCert]);
  const result = tls.getCACertificates();
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], fixtureCert);
  
  // Should accept Uint8Array
  const uint8Cert = new Uint8Array(Buffer.from(fixtureCert, 'utf8'));
  tls.setDefaultCACertificates([uint8Cert]);
  const uint8Result = tls.getCACertificates();
  assert.strictEqual(uint8Result.length, 1);
  assert.strictEqual(uint8Result[0], fixtureCert);
}

// Test that changes are thread-local (documented behavior)
{
  const bundledCerts = tls.getCACertificates('bundled');
  const originalCount = bundledCerts.length;
  
  // Set to subset
  const subset = bundledCerts.slice(0, 3);
  tls.setDefaultCACertificates(subset);
  assert.strictEqual(tls.getCACertificates().length, 3);
  
  // Reset to original
  tls.setDefaultCACertificates(bundledCerts);
  assert.strictEqual(tls.getCACertificates().length, originalCount);
}