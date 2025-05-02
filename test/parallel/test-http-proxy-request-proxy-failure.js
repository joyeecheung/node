'use strict';

// This tests that when the proxy server returns a 500 response, the client can
// handle it correctly.
const common = require('../common');
const assert = require('assert');
const { once } = require('events');
const http = require('http');
const { createProxyServer, runProxiedRequest } = require('../common/proxy-server');

(async () => {
  // Start a server to process the final request.
  const server = http.createServer(common.mustCall((req, res) => {
    req.destroy();
  }, 1));
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  // Start a minimal proxy server.
  const { proxy, logs } = createProxyServer();
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `http://${serverHost}/test`;

  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
  });

  // The proxy client should receive a well-formed 500 response.
  assert.match(stdout, /Proxy error: socket hang up/);
  assert.match(stdout, /Status Code: 500/);
  assert.strictEqual(stderr.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  // The proxy should receive a GET request.
  assert.deepStrictEqual(logs[0], {
    method: 'GET',
    url: requestUrl,
    headers: {
      'connection': 'keep-alive',
      'proxy-connection': 'keep-alive',
      'host': serverHost
    }
  });

  // The proxy should receive a ECONNRESET from the target server, and then send
  // 500 to the client.
  assert.strictEqual(logs[1].source,  'proxy request');
  assert.strictEqual(logs[1].error.code, 'ECONNRESET');
  proxy.close();
  server.close();
})().then(common.mustCall());
