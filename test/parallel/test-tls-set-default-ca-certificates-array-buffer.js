// Flags: --no-use-system-ca
// This tests tls.setDefaultCACertificates() support ArrayBufferView.
'use strict';

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const tls = require('tls');
const fixtures = require('../common/fixtures');

const fixtureCert = fixtures.readKey('fake-startcom-root-cert.pem');

// Should accept Buffer.
tls.setDefaultCACertificates([Buffer.from(fixtureCert)]);
const result = tls.getCACertificates('default');
assert.deepStrictEqual(result, [fixtureCert]);

// Reset it to empty.
tls.setDefaultCACertificates([]);
assert.deepStrictEqual(tls.getCACertificates('default'), []);

// Should accept Uint8Array.
const encoder = new TextEncoder();
const uint8Cert = encoder.encode(fixtureCert);
tls.setDefaultCACertificates([uint8Cert]);
const uint8Result = tls.getCACertificates('default');
assert.deepStrictEqual(uint8Result, [fixtureCert]);

// Reset it to empty.
tls.setDefaultCACertificates([]);
assert.deepStrictEqual(tls.getCACertificates('default'), []);

// Should accept DataView.
const dataViewCert = new DataView(uint8Cert.buffer, uint8Cert.byteOffset, uint8Cert.byteLength);
tls.setDefaultCACertificates([dataViewCert]);
const dataViewResult = tls.getCACertificates('default');
assert.deepStrictEqual(dataViewResult, [fixtureCert]);
