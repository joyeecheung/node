'use strict';

// Test script for NODE_EXTRA_CA_CERTS isolation verification

const tls = require('tls');
const assert = require('assert');
const fixtures = require('../common/fixtures');

// Assert that NODE_EXTRA_CA_CERTS is set
assert(process.env.NODE_EXTRA_CA_CERTS, 'NODE_EXTRA_CA_CERTS environment variable should be set');

const originalBundled = tls.getCACertificates('bundled');
const originalExtra = tls.getCACertificates('extra');
const originalSystem = tls.getCACertificates('system');

// Assert that NODE_EXTRA_CA_CERTS loaded certificates
assert(originalExtra.length > 0, 'NODE_EXTRA_CA_CERTS should have loaded certificates');

console.log('Found', originalExtra.length, 'extra certificates');

// Override defaults with custom certificate
const customCert = fixtures.readKey('fake-cnnic-root-cert.pem');
tls.setDefaultCACertificates([customCert]);

// Verify other types are completely unchanged
const currentBundled = tls.getCACertificates('bundled');
const currentExtra = tls.getCACertificates('extra');
const currentSystem = tls.getCACertificates('system');
const currentDefaults = tls.getCACertificates('default');

assert.deepStrictEqual(currentBundled, originalBundled);
assert.deepStrictEqual(currentExtra, originalExtra);
assert.deepStrictEqual(currentSystem, originalSystem);
assert.deepStrictEqual(currentDefaults, [customCert]);
console.log('PASS: All cert types isolated properly');

// Verify strict independence - custom cert should not appear in other types
assert(!currentBundled.includes(customCert), 
       'Custom certificate should not appear in bundled certs');
assert(!currentExtra.includes(customCert) || originalExtra.includes(customCert), 
       'Custom certificate should not appear in extra certs unless it was already there');
assert(!currentSystem.includes(customCert) || originalSystem.includes(customCert), 
       'Custom certificate should not appear in system certs unless it was already there');
console.log('PASS: Custom cert properly isolated');

console.log('SUCCESS: All isolation tests passed');