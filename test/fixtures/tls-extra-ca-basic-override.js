'use strict';

// Test script for basic NODE_EXTRA_CA_CERTS override functionality

const tls = require('tls');
const assert = require('assert');

// Assert that NODE_EXTRA_CA_CERTS is set
assert(process.env.NODE_EXTRA_CA_CERTS, 'NODE_EXTRA_CA_CERTS environment variable should be set');

// Get initial state with extra CA
const initialDefaults = tls.getCACertificates('default');
const bundledCerts = tls.getCACertificates('bundled');
const extraCerts = tls.getCACertificates('extra');

// Assert that NODE_EXTRA_CA_CERTS loaded certificates
assert(extraCerts.length > 0, 'NODE_EXTRA_CA_CERTS should have loaded certificates');

// Verify extra certs are included in defaults initially
const hasExtraCerts = extraCerts.some(cert => initialDefaults.includes(cert));
assert(hasExtraCerts, 'Extra certificates should be included in default CA store');
console.log('PASS: Extra certs included in defaults');

// Override with bundled certificates only
tls.setDefaultCACertificates(bundledCerts);
const newDefaults = tls.getCACertificates('default');

// Verify complete replacement
assert.deepStrictEqual(newDefaults, bundledCerts);
console.log('PASS: Overridden with bundled certs');

// Verify extra certs are no longer in defaults
const hasExtraCerts = extraCerts.some(cert => newDefaults.includes(cert));
assert(!hasExtraCerts, 'Extra certificates should not be in overridden default store');
console.log('PASS: Extra certs removed from defaults');

// Verify extra cert type is unchanged
const stillExtraCerts = tls.getCACertificates('extra');
assert.deepStrictEqual(stillExtraCerts, extraCerts);
console.log('PASS: Extra cert type unchanged');

console.log('SUCCESS: All tests passed');