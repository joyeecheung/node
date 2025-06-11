'use strict';

// This tests that when the proxy server rejects authentication for CONNECT,
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

  // Start a proxy server that rejects authentication.
  const proxy = http.createServer();
  proxy.on('connect', common.mustCall((req, res) => {
    res.write('HTTP/1.1 407 Proxy Authentication Required\r\n');
    res.write('Proxy-Authenticate: Basic realm="proxy"\r\n');
    res.write('\r\n');
    res.end();
  }, 1));
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;

  const { code, signal, stderr } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTPS_PROXY: `http://baduser:badpass@localhost:${proxy.address().port}`,
    NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
  });

  // The proxy client should get an error from proxy authentication failure.
  // Since the process exits cleanly but with an error, check for any error output
  assert.match(stderr, /407 Proxy Authentication Required/);
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  proxy.close();
  server.close();
})().then(common.mustCall());
