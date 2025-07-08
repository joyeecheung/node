'use strict';

// Test script for restoring NODE_EXTRA_CA_CERTS functionality

const tls = require('tls');
const assert = require('assert');

// Assert that NODE_EXTRA_CA_CERTS is set
assert(process.env.NODE_EXTRA_CA_CERTS, 'NODE_EXTRA_CA_CERTS environment variable should be set');

const bundledCerts = tls.getCACertificates('bundled');
const extraCerts = tls.getCACertificates('extra');

// Assert that NODE_EXTRA_CA_CERTS loaded certificates
assert(extraCerts.length > 0, 'NODE_EXTRA_CA_CERTS should have loaded certificates');

// Override with bundled only
tls.setDefaultCACertificates(bundledCerts);
let currentDefaults = tls.getCACertificates('default');
assert.deepStrictEqual(currentDefaults, bundledCerts);
console.log('PASS: Overridden with bundled certs');

// Restore by combining bundled and extra
const combinedCerts = [...bundledCerts, ...extraCerts];
tls.setDefaultCACertificates(combinedCerts);
currentDefaults = tls.getCACertificates('default');

// Verify restoration
assert.deepStrictEqual(currentDefaults, combinedCerts);
console.log('PASS: Restored extra certs');

// Verify extra certs are back in defaults
const hasExtraCerts = extraCerts.some(cert => currentDefaults.includes(cert));
assert(hasExtraCerts, 'Extra certificates should be restored in defaults');
console.log('PASS: Extra certs verified in defaults');

console.log('SUCCESS: All tests passed');