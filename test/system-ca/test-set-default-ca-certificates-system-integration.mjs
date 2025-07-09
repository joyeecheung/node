// Flags: --use-system-ca

// This tests integration between tls.setDefaultCACertificates() and system CA certificates.
// Requires fake-startcom-root-cert.pem to be installed in the system CA store.

import * as common from '../common/index.mjs';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import fixtures from '../common/fixtures.js';
import { it, describe } from 'node:test';
import { once } from 'events';

if (!common.hasCrypto) {
  common.skip('requires crypto');
}

describe('System CA integration with setDefaultCACertificates', function() {
  async function setupServer() {
    const theServer = https.createServer({
      key: fixtures.readKey('agent8-key.pem'),
      cert: fixtures.readKey('agent8-cert.pem'),
    }, (req, res) => {
      res.writeHead(200);
      res.end('integration test\n');
    });
    theServer.listen(0);
    await once(theServer, 'listening');
    return theServer;
  }

  it('verifies that --use-system-ca affects default CA behavior', async function() {
    const server = await setupServer();
    const url = `https://localhost:${server.address().port}/`;
    const fakeStartcomCert = fixtures.readKey('fake-startcom-root-cert.pem');

    try {
      // Get system and bundled certificates
      const systemCerts = tls.getCACertificates('system');
      const bundledCerts = tls.getCACertificates('bundled');
      const initialDefaults = tls.getCACertificates('default');

      // With --use-system-ca, initial defaults should include system certs
      // Check if system certs are part of the defaults

      if (!systemCerts.includes(fakeStartcomCert)) {
        common.skip('fake-startcom-root-cert.pem not found in system CA store');
      }

      // Verify connection works initially (should work with system CA)
      const response1 = await fetch(url);
      assert.strictEqual(response1.status, 200);

      // Override with empty array - should break connection
      tls.setDefaultCACertificates([]);

      await assert.rejects(fetch(url), (err) => {
        assert(err.cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
               err.cause.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
               err.cause.code === 'SELF_SIGNED_CERT_IN_CHAIN');
        return true;
      });

      // Manually set just the needed certificate - should work
      tls.setDefaultCACertificates([fakeStartcomCert]);

      const response2 = await fetch(url);
      assert.strictEqual(response2.status, 200);

      // Verify that system and bundled cert types are unaffected
      assert.deepStrictEqual(tls.getCACertificates('system'), systemCerts);
      assert.deepStrictEqual(tls.getCACertificates('bundled'), bundledCerts);

    } finally {
      server.close();
    }
  });

  it('can combine system and bundled certificates', async function() {
    const server = await setupServer();
    const url = `https://localhost:${server.address().port}/`;

    try {
      const systemCerts = tls.getCACertificates('system');
      const bundledCerts = tls.getCACertificates('bundled');
      const fakeStartcomCert = fixtures.readKey('fake-startcom-root-cert.pem');

      if (!systemCerts.includes(fakeStartcomCert)) {
        common.skip('fake-startcom-root-cert.pem not found in system CA store');
      }

      // Combine system and bundled certificates
      const combinedCerts = [...systemCerts, ...bundledCerts];
      tls.setDefaultCACertificates(combinedCerts);

      // Connection should work
      const response = await fetch(url);
      assert.strictEqual(response.status, 200);

      // Verify the combined store contains certificates from both sources
      const currentDefaults = tls.getCACertificates('default');
      assert.strictEqual(currentDefaults.length, combinedCerts.length);

      // Check that system certificate is present
      assert(currentDefaults.includes(fakeStartcomCert));

      // Check that some bundled certificates are present
      const hasBundledCerts = bundledCerts.some((cert) => currentDefaults.includes(cert));
      assert(hasBundledCerts, 'Combined store should contain bundled certificates');

    } finally {
      server.close();
    }
  });
});
