'use strict';

// This tests error recovery and fallback behavior for tls.setDefaultCACertificates()

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Test that invalid array elements don't prevent valid function operation
{
  const validCert = fixtures.readKey('fake-startcom-root-cert.pem');
  const originalDefaults = tls.getCACertificates('default');
  
  // First set valid certificates
  tls.setDefaultCACertificates([validCert]);
  const afterValid = tls.getCACertificates('default');
  assert.strictEqual(afterValid.length, 1);
  assert.strictEqual(afterValid[0], validCert);
  
  // Test with invalid array element types (should throw and leave state unchanged)
  assert.throws(() => {
    tls.setDefaultCACertificates([validCert, null]);
  }, {
    code: 'ERR_INVALID_ARG_TYPE'
  });
  
  // Verify state is unchanged after error
  const afterError = tls.getCACertificates('default');
  assert.deepStrictEqual(afterError, afterValid);
}

// Test error recovery after multiple invalid attempts
{
  const validCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Set initial valid state
  tls.setDefaultCACertificates([validCert]);
  const initialState = tls.getCACertificates('default');
  
  // Multiple invalid attempts
  for (const invalid of [null, undefined, 42, {}, 'string']) {
    assert.throws(() => {
      tls.setDefaultCACertificates(invalid);
    }, {
      code: 'ERR_INVALID_ARG_TYPE'
    });
    
    // Verify state remains unchanged
    const currentState = tls.getCACertificates('default');
    assert.deepStrictEqual(currentState, initialState);
  }
  
  // Verify we can still set valid certificates after errors
  const bundledCerts = tls.getCACertificates('bundled').slice(0, 3);
  tls.setDefaultCACertificates(bundledCerts);
  const finalState = tls.getCACertificates('default');
  assert.deepStrictEqual(finalState, bundledCerts);
}

// Test restoring defaults after setting custom certificates
{
  const bundledCerts = tls.getCACertificates('bundled');
  const customCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Set custom certificate
  tls.setDefaultCACertificates([customCert]);
  const afterCustom = tls.getCACertificates('default');
  assert.strictEqual(afterCustom.length, 1);
  assert.strictEqual(afterCustom[0], customCert);
  
  // Restore to bundled certificates
  tls.setDefaultCACertificates(bundledCerts);
  const afterRestore = tls.getCACertificates('default');
  assert.deepStrictEqual(afterRestore, bundledCerts);
}

// Test behavior with empty arrays and restoration
{
  const bundledCerts = tls.getCACertificates('bundled');
  
  // Set to empty array
  tls.setDefaultCACertificates([]);
  const afterEmpty = tls.getCACertificates('default');
  assert.strictEqual(afterEmpty.length, 0);
  
  // Restore with non-empty certificates
  tls.setDefaultCACertificates(bundledCerts);
  const afterRestore = tls.getCACertificates('default');
  assert.deepStrictEqual(afterRestore, bundledCerts);
  
  // Set to empty again
  tls.setDefaultCACertificates([]);
  const afterEmptyAgain = tls.getCACertificates('default');
  assert.strictEqual(afterEmptyAgain.length, 0);
}

// Test partial array validation (array with invalid element types)
{
  const validCert = fixtures.readKey('fake-startcom-root-cert.pem');
  const beforeState = tls.getCACertificates('default');
  
  // Test various invalid element types in array
  const invalidElements = [null, undefined, 42, {}, [], true, Symbol('test')];
  
  for (const invalid of invalidElements) {
    assert.throws(() => {
      tls.setDefaultCACertificates([validCert, invalid]);
    }, {
      code: 'ERR_INVALID_ARG_TYPE'
    });
    
    // Verify state unchanged after each error
    const currentState = tls.getCACertificates('default');
    assert.deepStrictEqual(currentState, beforeState);
  }
}