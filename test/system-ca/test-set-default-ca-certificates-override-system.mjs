// Flags: --use-system-ca

// This tests that tls.setDefaultCACertificates() can override system CA certificates
// when --use-system-ca is enabled. Requires fake-startcom-root-cert.pem to be
// installed in the system CA store as described in README.md

import * as common from '../common/index.mjs';
import assert from 'node:assert/strict';
import fixtures from '../common/fixtures.js';
import { it, afterEach, beforeEach, describe } from 'node:test';
import { once } from 'events';
import { includesCert, assertEqualCerts } from '../common/tls.js';

if (!common.hasCrypto) {
  common.skip('requires crypto');
}

const { default: https } = await import('node:https');
const { default: tls } = await import('node:tls');

// Verify that system CA includes the fake-startcom-root-cert.
const systemCerts = tls.getCACertificates('system');
const fixturesCert = fixtures.readKey('fake-startcom-root-cert.pem');
if (!includesCert(systemCerts, fixturesCert)) {
  common.skip('fake-startcom-root-cert.pem not found in system CA store. ' +
              'Please follow setup instructions in test/system-ca/README.md');
}
const bundledCerts = tls.getCACertificates('bundled');
if (includesCert(bundledCerts, fixturesCert)) {
  common.skip('fake-startcom-root-cert.pem should not be in bundled CA store');
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
    const fixturesCert = fixtures.readKey('fake-startcom-root-cert.pem');

    // First, verify connection works with system CA (including fake-startcom-root-cert)
    const response1 = await fetch(`${url}/system-ca-test`);
    assert.strictEqual(response1.status, 200);
    const text1 = await response1.text();
    assert.strictEqual(text1, 'system ca works\n');

    // Now override with bundled certs (which do not include fake-startcom-root-cert)
    tls.setDefaultCACertificates(bundledCerts);

    // Connection should now fail because fake-startcom-root-cert is no longer in the CA store.
    // Use IP address to skip session cache.
    await assert.rejects(
      fetch(`https://127.0.0.1:${server.address().port}/bundled-ca-test`),
      (err) => {
        assert.strictEqual(err.cause.code, 'SELF_SIGNED_CERT_IN_CHAIN');
        return true;
      },
    );

    // Verify that system CA type still returns original system certs
    const stillSystemCerts = tls.getCACertificates('system');
    assertEqualCerts(stillSystemCerts, systemCerts);
    assert(includesCert(stillSystemCerts, fixturesCert));

    // Verify that default CA now returns bundled certs
    const currentDefaults = tls.getCACertificates('default');
    assertEqualCerts(currentDefaults, bundledCerts);
    assert(!includesCert(currentDefaults, fixturesCert));
  });

  afterEach(async function() {
    server?.close();
  });
});
