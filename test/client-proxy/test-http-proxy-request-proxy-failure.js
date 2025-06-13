'use strict';

// This tests that when the proxy server returns a 500 response, the client can
// handle it correctly.
const common = require('../common');
const assert = require('assert');
const { once } = require('events');
const http = require('http');
const { runProxiedRequest } = require('../common/proxy-server');

(async () => {
  const server = http.createServer(common.mustNotCall());
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  // Start a proxy server that just hangs up.
  const proxy = http.createServer();
  proxy.on('request', common.mustCall((req, res) => {
    req.destroy();
  }, 1));
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `http://${serverHost}/test`;

  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
  });

  // The proxy client should get hung up by the proxy server.
  assert.match(stderr, /Error: socket hang up/);
  assert.strictEqual(stdout.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  proxy.close();
  server.close();
})().then(common.mustCall());
