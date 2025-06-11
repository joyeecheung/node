'use strict';

// This tests that when the proxy server connection is refused, the client can
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

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `http://${serverHost}/test`;

  // Use a port that is very unlikely to be in use
  const unusedPort = 55555;

  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${unusedPort}`,
  });

  // The proxy client should get a connection refused error.
  assert.match(stderr, /Error.*connect ECONNREFUSED/);
  assert.strictEqual(stdout.trim(), '');
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);

  server.close();
})().then(common.mustCall());
