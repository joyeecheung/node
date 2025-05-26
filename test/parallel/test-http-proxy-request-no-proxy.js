'use strict';

// This tests that NO_PROXY environment variable is respected for HTTP requests.
const common = require('../common');
const assert = require('assert');
const { once } = require('events');
const http = require('http');
const { runProxiedRequest } = require('../common/proxy-server');

(async () => {
  // Start a server to process the final request.
  const server = http.createServer(common.mustCall((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello World\n');
  }, 1));
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  // Start a proxy server that should NOT be used.
  const proxy = http.createServer();
  proxy.on('request', common.mustNotCall());
  proxy.on('connect', common.mustNotCall());
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `http://${serverHost}/test`;

  // Test NO_PROXY with exact hostname match
  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
    NO_PROXY: 'localhost',
  });

  // The request should succeed and bypass proxy
  assert.match(stdout, /Status Code: 200/);
  assert.match(stdout, /Hello World/);
  assert.strictEqual(stderr.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  proxy.close();
  server.close();
})().then(common.mustCall());