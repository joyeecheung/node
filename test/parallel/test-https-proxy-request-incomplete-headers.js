'use strict';

// This tests that when the proxy server returns incomplete headers for CONNECT,
// the client can handle it correctly.
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

  // Start a proxy server that sends incomplete headers.
  const proxy = http.createServer();
  proxy.on('connect', common.mustCall((req, res) => {
    res.write('HTTP/1.1 200 Connection Established\r\n');
    // Missing the final \r\n to complete headers - this should cause a hang/timeout
  }, 1));
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;

  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    REQUEST_TIMEOUT: 1000,
    HTTPS_PROXY: `http://localhost:${proxy.address().port}`,
    NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
  });

  // The proxy client should get a connection timeout.
  assert.match(stderr, /Request timed out/);
  assert.strictEqual(stdout.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  proxy.close();
  server.close();
})().then(common.mustCall());