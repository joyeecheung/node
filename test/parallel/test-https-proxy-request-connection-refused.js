'use strict';

// This tests that when the proxy server connection is refused, the HTTPS client can
// handle it correctly.
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const assert = require('assert');
const { once } = require('events');
const https = require('https');
const { runProxiedRequest } = require('../common/proxy-server');

(async () => {
  const server = https.createServer({
    cert: fixtures.readKey('agent8-cert.pem'),
    key: fixtures.readKey('agent8-key.pem'),
  }, common.mustNotCall());
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;

  // Use a port that is very unlikely to be in use
  const unusedPort = 55556;

  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTPS_PROXY: `http://localhost:${unusedPort}`,
    NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
  });

  // The proxy client should get a connection refused error.
  assert.match(stderr, /Error.*connect ECONNREFUSED/);
  assert.strictEqual(stdout.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  server.close();
})().then(common.mustCall());
