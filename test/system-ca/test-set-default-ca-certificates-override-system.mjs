// Flags: --use-system-ca

// This tests that tls.setDefaultCACertificates() can override system CA certificates
// when --use-system-ca is enabled. Requires fake-startcom-root-cert.pem to be
// installed in the system CA store as described in README.md

import * as common from '../common/index.mjs';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import fixtures from '../common/fixtures.js';
import { it, beforeEach, describe } from 'node:test';
import { once } from 'events';

if (!common.hasCrypto) {
  common.skip('requires crypto');
}

const handleRequest = (req, res) => {
  const path = req.url;
  switch (path) {
    case '/system-ca-test':
      res.writeHead(200);
      res.end('system ca works\n');
      break;
    case '/bundled-ca-test':
      res.writeHead(200);
      res.end('bundled ca works\n');
      break;
    default:
      assert(false, `Unexpected path: ${path}`);
  }
};

describe('tls.setDefaultCACertificates() with --use-system-ca', function() {
  async function setupServer() {
    const theServer = https.createServer({
      key: fixtures.readKey('agent8-key.pem'),
      cert: fixtures.readKey('agent8-cert.pem'),
    }, handleRequest);
    theServer.listen(0);
    await once(theServer, 'listening');

    return theServer;
  }

  let server;

  beforeEach(async function() {
    server = await setupServer();
  });

  it('verifies system CA includes fake-startcom-root-cert and can be overridden', async function() {
    const url = `https://localhost:${server.address().port}`;
    const fakeStartcomCert = fixtures.readKey('fake-startcom-root-cert.pem');

    // Verify that system CA includes the fake-startcom-root-cert
    // (This assumes the certificate was installed as per README.md instructions)
    const systemCerts = tls.getCACertificates('system');
    const hasFakeStartcom = systemCerts.includes(fakeStartcomCert);

    if (!hasFakeStartcom) {
      // Skip test if fake-startcom-root-cert is not in system CA store
      // This is expected if the setup instructions in README.md were not followed
      common.skip('fake-startcom-root-cert.pem not found in system CA store. ' +
                  'Please follow setup instructions in test/system-ca/README.md');
    }

    // First, verify connection works with system CA (including fake-startcom-root-cert)
    const response1 = await fetch(`${url}/system-ca-test`);
    assert.strictEqual(response1.status, 200);
    const text1 = await response1.text();
    assert.strictEqual(text1, 'system ca works\n');

    // Now override with bundled certificates (which don't include fake-startcom-root-cert)
    const bundledCerts = tls.getCACertificates('bundled');
    assert(!bundledCerts.includes(fakeStartcomCert),
           'fake-startcom-root-cert should not be in bundled certificates');

    tls.setDefaultCACertificates(bundledCerts);

    // Connection should now fail because fake-startcom-root-cert is no longer in the CA store
    await assert.rejects(
      fetch(`${url}/bundled-ca-test`),
      (err) => {
        assert(err.cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
               err.cause.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
               err.cause.code === 'SELF_SIGNED_CERT_IN_CHAIN');
        return true;
      },
    );

    // Verify that system CA type still returns original system certs
    const stillSystemCerts = tls.getCACertificates('system');
    assert.deepStrictEqual(stillSystemCerts, systemCerts);
    assert(stillSystemCerts.includes(fakeStartcomCert));

    // Verify that default CA now returns bundled certs
    const currentDefaults = tls.getCACertificates('default');
    assert.deepStrictEqual(currentDefaults, bundledCerts);
    assert(!currentDefaults.includes(fakeStartcomCert));
  });

  it('can restore system CA functionality after override', async function() {
    const url = `https://localhost:${server.address().port}`;
    const fakeStartcomCert = fixtures.readKey('fake-startcom-root-cert.pem');
    const systemCerts = tls.getCACertificates('system');

    if (!systemCerts.includes(fakeStartcomCert)) {
      common.skip('fake-startcom-root-cert.pem not found in system CA store');
    }

    // Override with bundled certs first
    const bundledCerts = tls.getCACertificates('bundled');
    tls.setDefaultCACertificates(bundledCerts);

    // Connection should fail
    await assert.rejects(fetch(`${url}/bundled-ca-test`));

    // Restore system CA functionality by setting defaults back to system certs
    tls.setDefaultCACertificates(systemCerts);

    // Connection should work again
    const response = await fetch(`${url}/system-ca-test`);
    assert.strictEqual(response.status, 200);
    const text = await response.text();
    assert.strictEqual(text, 'system ca works\n');
  });

  afterEach(async function() {
    server?.close();
  });
});
