'use strict';

// This tests mixed input types for tls.setDefaultCACertificates()
// including ArrayBufferView, mixed types, and edge cases

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Test mixed string and ArrayBufferView inputs
{
  const stringCert = fixtures.readKey('fake-startcom-root-cert.pem');
  const bufferCert = Buffer.from(stringCert, 'utf8');
  const uint8Cert = new Uint8Array(Buffer.from(stringCert, 'utf8'));
  
  // Test mixed array with string and Buffer
  tls.setDefaultCACertificates([stringCert, bufferCert]);
  const result1 = tls.getCACertificates();
  assert.strictEqual(result1.length, 2);
  assert.strictEqual(result1[0], stringCert);
  assert.strictEqual(result1[1], stringCert); // Buffer gets converted to string
  
  // Test mixed array with string and Uint8Array
  tls.setDefaultCACertificates([stringCert, uint8Cert]);
  const result2 = tls.getCACertificates();
  assert.strictEqual(result2.length, 2);
  assert.strictEqual(result2[0], stringCert);
  assert.strictEqual(result2[1], stringCert); // Uint8Array gets converted to string
}

// Test various ArrayBufferView types
{
  const certString = fixtures.readKey('fake-startcom-root-cert.pem');
  const certBuffer = Buffer.from(certString, 'utf8');
  
  // Test with different ArrayBufferView types
  const uint8Array = new Uint8Array(certBuffer);
  const int8Array = new Int8Array(certBuffer);
  const uint16Array = new Uint16Array(certBuffer.buffer, certBuffer.byteOffset, certBuffer.byteLength / 2);
  
  // Test Uint8Array
  tls.setDefaultCACertificates([uint8Array]);
  const result1 = tls.getCACertificates();
  assert.strictEqual(result1.length, 1);
  assert.strictEqual(result1[0], certString);
  
  // Test Int8Array
  tls.setDefaultCACertificates([int8Array]);
  const result2 = tls.getCACertificates();
  assert.strictEqual(result2.length, 1);
  assert.strictEqual(result2[0], certString);
  
  // Test Buffer (which is a Uint8Array subclass)
  tls.setDefaultCACertificates([certBuffer]);
  const result3 = tls.getCACertificates();
  assert.strictEqual(result3.length, 1);
  assert.strictEqual(result3[0], certString);
}

// Test DataView (another ArrayBufferView type)
{
  const certString = fixtures.readKey('fake-startcom-root-cert.pem');
  const certBuffer = Buffer.from(certString, 'utf8');
  const dataView = new DataView(certBuffer.buffer, certBuffer.byteOffset, certBuffer.byteLength);
  
  tls.setDefaultCACertificates([dataView]);
  const result = tls.getCACertificates();
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], certString);
}

// Test malformed PEM (should not throw during setting)
{
  const malformedPems = [
    'not a certificate',
    '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----',
    '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----', // empty
    'BEGIN CERTIFICATE\nmissing dashes\nEND CERTIFICATE'
  ];
  
  // Should not throw during the call
  assert.doesNotThrow(() => {
    tls.setDefaultCACertificates(malformedPems);
  });
  
  const result = tls.getCACertificates();
  assert.strictEqual(result.length, malformedPems.length);
  assert.deepStrictEqual(result, malformedPems);
}

// Test very large certificate array
{
  const cert = fixtures.readKey('fake-startcom-root-cert.pem');
  const largeCertArray = new Array(100).fill(cert);
  
  assert.doesNotThrow(() => {
    tls.setDefaultCACertificates(largeCertArray);
  });
  
  const result = tls.getCACertificates();
  assert.strictEqual(result.length, 100);
  assert(result.every(c => c === cert));
}