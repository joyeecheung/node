// Flags: --use-system-ca

// This tests that tls.setDefaultCACertificates() properly overrides system CA certificates
// when --use-system-ca is enabled, using only tls.getCACertificates() for verification.

'use strict';

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Verify system CA is included in defaults initially
{
  const systemCerts = tls.getCACertificates('system');
  const initialDefaults = tls.getCACertificates('default');
  const bundledCerts = tls.getCACertificates('bundled');
  
  // With --use-system-ca, defaults should include both bundled and system certs
  assert(initialDefaults.length > bundledCerts.length, 
         'Default CA store should be larger than bundled when system CAs are included');
  
  // System certs should be present in defaults
  const hasSystemCerts = systemCerts.some(cert => initialDefaults.includes(cert));
  assert(hasSystemCerts, 'System certificates should be included in default CA store');
}

// Can override system CA defaults with bundled certificates only
{
  const systemCerts = tls.getCACertificates('system');
  const bundledCerts = tls.getCACertificates('bundled');
  const initialDefaults = tls.getCACertificates('default');
  
  // Override with bundled certificates only
  tls.setDefaultCACertificates(bundledCerts);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify complete replacement
  assert.deepStrictEqual(newDefaults, bundledCerts);
  assert.notDeepStrictEqual(newDefaults, initialDefaults);
  
  // Verify system certs are no longer in defaults
  const hasSystemCerts = systemCerts.some(cert => newDefaults.includes(cert));
  assert(!hasSystemCerts, 'System certificates should not be in overridden default store');
  
  // Verify system cert type is unchanged
  const stillSystemCerts = tls.getCACertificates('system');
  assert.deepStrictEqual(stillSystemCerts, systemCerts);
}

// Can override with empty array removing all system CAs
{
  const systemCerts = tls.getCACertificates('system');
  const initialDefaults = tls.getCACertificates('default');
  
  // Override with empty array
  tls.setDefaultCACertificates([]);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify complete removal
  assert.deepStrictEqual(newDefaults, []);
  assert.notDeepStrictEqual(newDefaults, initialDefaults);
  
  // Verify system cert type is unchanged
  const stillSystemCerts = tls.getCACertificates('system');
  assert.deepStrictEqual(stillSystemCerts, systemCerts);
}

// Can override with custom certificate replacing system CAs
{
  const systemCerts = tls.getCACertificates('system');
  const customCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Override with single custom certificate
  tls.setDefaultCACertificates([customCert]);
  
  const newDefaults = tls.getCACertificates('default');
  
  // Verify only custom certificate is present
  assert.strictEqual(newDefaults.length, 1);
  assert.strictEqual(newDefaults[0], customCert);
  
  // Verify no system certs in defaults
  const hasSystemCerts = systemCerts.some(cert => newDefaults.includes(cert));
  assert(!hasSystemCerts, 'System certificates should be completely replaced');
  
  // Verify system cert type is unchanged
  const stillSystemCerts = tls.getCACertificates('system');
  assert.deepStrictEqual(stillSystemCerts, systemCerts);
}

// Can restore system CA functionality by setting defaults back
{
  const systemCerts = tls.getCACertificates('system');
  const bundledCerts = tls.getCACertificates('bundled');
  
  // First override with bundled only
  tls.setDefaultCACertificates(bundledCerts);
  let currentDefaults = tls.getCACertificates('default');
  assert.deepStrictEqual(currentDefaults, bundledCerts);
  
  // Restore by setting to system certs
  tls.setDefaultCACertificates(systemCerts);
  currentDefaults = tls.getCACertificates('default');
  
  // Verify system certs are now the defaults
  assert.deepStrictEqual(currentDefaults, systemCerts);
  
  // Verify no bundled certs unless they're also in system
  const bundledOnlyInDefaults = bundledCerts.filter(cert => 
    currentDefaults.includes(cert) && !systemCerts.includes(cert));
  assert.strictEqual(bundledOnlyInDefaults.length, 0, 
                    'Only system certificates should be in defaults after restore');
}

// Verify independence of certificate types after override
{
  const originalSystem = tls.getCACertificates('system');
  const originalBundled = tls.getCACertificates('bundled');
  const customCert = fixtures.readKey('fake-startcom-root-cert.pem');
  
  // Override defaults with custom certificate
  tls.setDefaultCACertificates([customCert]);
  
  // Verify other types are completely unchanged
  const currentSystem = tls.getCACertificates('system');
  const currentBundled = tls.getCACertificates('bundled');
  const currentDefaults = tls.getCACertificates('default');
  
  assert.deepStrictEqual(currentSystem, originalSystem);
  assert.deepStrictEqual(currentBundled, originalBundled);
  assert.deepStrictEqual(currentDefaults, [customCert]);
  
  // Verify strict independence - no overlap unless coincidental
  assert(!currentSystem.includes(customCert) || 
         originalSystem.includes(customCert),
         'Custom certificate should not appear in system certs unless it was already there');
  assert(!currentBundled.includes(customCert),
         'Custom certificate should not appear in bundled certs');
}