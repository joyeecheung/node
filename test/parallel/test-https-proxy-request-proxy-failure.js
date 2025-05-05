'use strict';

// This tests that when the proxy server hangs up the tunnel connection,
// the client can receive a correct error.
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const assert = require('assert');
const { once } = require('events');
const https = require('https');
const http = require('http');
const { runProxiedRequest } = require('../common/proxy-server');

(async () => {
  const server = https.createServer({
    cert: fixtures.readKey('agent8-cert.pem'),
    key: fixtures.readKey('agent8-key.pem'),
  }, common.mustNotCall());
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  // Start a proxy server that just hangs up the tunnel.
  const proxy = http.createServer();
  proxy.on('connect', common.mustCall((req, res) => {
    req.destroy();
  }, 1));
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;

  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTPS_PROXY: `http://localhost:${proxy.address().port}`,
    NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
  });

  // The proxy client should get hung up by the proxy server.
  assert.match(stderr, /ERR_PROXY_ERROR.*Connection to establish proxy tunnel ended unexpectedly/);
  assert.strictEqual(stdout.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  proxy.close();
  server.close();
})().then(common.mustCall());
