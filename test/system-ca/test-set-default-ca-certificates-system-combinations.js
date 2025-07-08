// Flags: --use-system-ca

// This tests various combinations of system CA certificates with tls.setDefaultCACertificates()
// using only tls.getCACertificates() for verification.

'use strict';

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Can combine system and bundled certificates
{
  const systemCerts = tls.getCACertificates('system');
  const bundledCerts = tls.getCACertificates('bundled');
  
  // Combine system and bundled certificates
  const combinedCerts = [...systemCerts, ...bundledCerts];
  tls.setDefaultCACertificates(combinedCerts);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify all certificates are present
  assert.strictEqual(newDefaults.length, combinedCerts.length);
  assert.deepStrictEqual(newDefaults, combinedCerts);
  
  // Verify system certificates are in the expected positions
  for (let i = 0; i < systemCerts.length; i++) {
    assert.strictEqual(newDefaults[i], systemCerts[i]);
  }
  
  // Verify bundled certificates follow system certificates
  for (let i = 0; i < bundledCerts.length; i++) {
    assert.strictEqual(newDefaults[systemCerts.length + i], bundledCerts[i]);
  }
}

// Can append custom certificate to system certificates
{
  const systemCerts = tls.getCACertificates('system');
  const customCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Append custom certificate to system certificates
  const extendedCerts = [...systemCerts, customCert];
  tls.setDefaultCACertificates(extendedCerts);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify all certificates are present
  assert.strictEqual(newDefaults.length, systemCerts.length + 1);
  assert.deepStrictEqual(newDefaults, extendedCerts);
  
  // Verify system certificates are preserved
  for (let i = 0; i < systemCerts.length; i++) {
    assert.strictEqual(newDefaults[i], systemCerts[i]);
  }
  
  // Verify custom certificate is at the end
  assert.strictEqual(newDefaults[newDefaults.length - 1], customCert);
}

// Can prepend custom certificate to system certificates
{
  const systemCerts = tls.getCACertificates('system');
  const customCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Prepend custom certificate to system certificates
  const prependedCerts = [customCert, ...systemCerts];
  tls.setDefaultCACertificates(prependedCerts);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify all certificates are present
  assert.strictEqual(newDefaults.length, systemCerts.length + 1);
  assert.deepStrictEqual(newDefaults, prependedCerts);
  
  // Verify custom certificate is first
  assert.strictEqual(newDefaults[0], customCert);
  
  // Verify system certificates follow
  for (let i = 0; i < systemCerts.length; i++) {
    assert.strictEqual(newDefaults[i + 1], systemCerts[i]);
  }
}

// Can interleave custom certificates with system certificates
{
  const systemCerts = tls.getCACertificates('system');
  const customCert1 = fixtures.readKey('fake-startcom-root-cert.pem');
  const bundledCerts = tls.getCACertificates('bundled');
  const customCert2 = bundledCerts[0]; // Use a bundled cert as second custom cert
  
  // Create interleaved array
  const interleavedCerts = [
    customCert1,
    ...systemCerts.slice(0, Math.min(2, systemCerts.length)),
    customCert2,
    ...systemCerts.slice(Math.min(2, systemCerts.length))
  ];
  
  tls.setDefaultCACertificates(interleavedCerts);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify exact match
  assert.deepStrictEqual(newDefaults, interleavedCerts);
  
  // Verify specific positions
  assert.strictEqual(newDefaults[0], customCert1);
  if (systemCerts.length > 0) {
    assert.strictEqual(newDefaults[1], systemCerts[0]);
  }
  if (systemCerts.length > 1) {
    assert.strictEqual(newDefaults[2], systemCerts[1]);
    assert.strictEqual(newDefaults[3], customCert2);
  }
}

// Can remove specific system certificates while keeping others
{
  const systemCerts = tls.getCACertificates('system');
  
  if (systemCerts.length < 2) {
    common.skip('Need at least 2 system certificates for this test');
  }
  
  // Remove every other system certificate
  const filteredCerts = systemCerts.filter((cert, index) => index % 2 === 0);
  tls.setDefaultCACertificates(filteredCerts);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify only filtered certificates are present
  assert.deepStrictEqual(newDefaults, filteredCerts);
  assert(newDefaults.length < systemCerts.length);
  
  // Verify removed certificates are not present
  const removedCerts = systemCerts.filter((cert, index) => index % 2 === 1);
  for (const removedCert of removedCerts) {
    assert(!newDefaults.includes(removedCert), 
           'Removed certificate should not be in defaults');
  }
  
  // Verify kept certificates are present
  for (const keptCert of filteredCerts) {
    assert(newDefaults.includes(keptCert), 
           'Kept certificate should be in defaults');
  }
}

// Handle duplicate certificates correctly
{
  const systemCerts = tls.getCACertificates('system');
  const customCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Create array with duplicates
  const certsWithDuplicates = [
    customCert,
    ...systemCerts.slice(0, Math.min(2, systemCerts.length)),
    customCert, // Duplicate custom cert
    ...systemCerts.slice(0, Math.min(1, systemCerts.length)), // Duplicate system cert
    customCert  // Another duplicate
  ];
  
  tls.setDefaultCACertificates(certsWithDuplicates);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify exact match including duplicates
  assert.deepStrictEqual(newDefaults, certsWithDuplicates);
  
  // Count occurrences of custom certificate
  const customCertCount = newDefaults.filter(cert => cert === customCert).length;
  assert.strictEqual(customCertCount, 3, 'Custom certificate should appear 3 times');
  
  // Count occurrences of first system certificate (if it exists)
  if (systemCerts.length > 0) {
    const firstSystemCertCount = newDefaults.filter(cert => cert === systemCerts[0]).length;
    assert.strictEqual(firstSystemCertCount, 2, 'First system certificate should appear 2 times');
  }
}