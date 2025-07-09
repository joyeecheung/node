'use strict';

// This tests that tls.setDefaultCACertificates() affects actual HTTPS connections

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const assert = require('assert');
const https = require('https');
const tls = require('tls');
const fixtures = require('../common/fixtures');

// Test HTTPS connection succeeds with proper CA, fails after removing it
{
  const server = https.createServer({
    cert: fixtures.readKey('agent8-cert.pem'),
    key: fixtures.readKey('agent8-key.pem'),
  }, (req, res) => {
    res.writeHead(200);
    res.end('hello world');
  });

  server.listen(0, common.mustCall(() => {
    const port = server.address().port;

    // First, set the correct CA certificate - connection should succeed
    tls.setDefaultCACertificates([fixtures.readKey('fake-startcom-root-cert.pem')]);

    const req1 = https.request({
      hostname: 'localhost',
      port: port,
      path: '/',
      method: 'GET'
    }, common.mustCall((res) => {
      assert.strictEqual(res.statusCode, 200);
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', common.mustCall(() => {
        assert.strictEqual(data, 'hello world');

        // Now set empty CA store - connection should fail
        tls.setDefaultCACertificates([]);

        const req2 = https.request({
          hostname: 'localhost',
          port: port,
          path: '/',
          method: 'GET'
        }, common.mustNotCall('Should not succeed with empty CA store'));

        req2.on('error', common.mustCall((err) => {
          // Should fail with certificate verification error
          assert(err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
                 err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
                 err.code === 'SELF_SIGNED_CERT_IN_CHAIN');
          server.close();
        }));

        req2.end();
      }));
    }));

    req1.on('error', common.mustNotCall('Should not error with correct CA'));
    req1.end();
  }));
}
