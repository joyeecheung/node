// This tests that --fetch-env-proxy enables proxy support for fetch() but NOT
// for http.request(), and that NODE_FETCH_ENV_PROXY=1 has the same effect.

import * as common from '../common/index.mjs';
import assert from 'node:assert';
import http from 'node:http';
import { once } from 'events';
import { createProxyServer, runProxiedRequest, checkProxiedFetch } from '../common/proxy-server.js';

// Start a minimal proxy server.
const { proxy, logs } = createProxyServer();
proxy.listen(0);
await once(proxy, 'listening');

delete process.env.NODE_USE_ENV_PROXY; // Ensure the environment variable is not set.
delete process.env.NODE_FETCH_ENV_PROXY; // Ensure the environment variable is not set.

// Start a HTTP server to process the final request.
const server = http.createServer(common.mustCall((req, res) => {
  res.end('Hello world');
}, 4));
server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
server.listen(0);
await once(server, 'listening');

const serverHost = `localhost:${server.address().port}`;
const requestUrl = `http://${serverHost}/test`;

// --fetch-env-proxy enables fetch proxy.
{
  await checkProxiedFetch({
    FETCH_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
  }, {
    stdout: 'Hello world',
  }, ['--fetch-env-proxy']);

  assert.strictEqual(logs.length, 1);
  assert.deepStrictEqual(logs[0], {
    method: 'CONNECT',
    url: serverHost,
    headers: {
      'connection': 'close',
      'proxy-connection': 'keep-alive',
      'host': serverHost,
    },
  });

  logs.splice(0, logs.length);
}

// NODE_FETCH_ENV_PROXY=1 enables fetch proxy.
{
  await checkProxiedFetch({
    NODE_FETCH_ENV_PROXY: '1',
    FETCH_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
  }, {
    stdout: 'Hello world',
  });

  assert.strictEqual(logs.length, 1);
  assert.deepStrictEqual(logs[0], {
    method: 'CONNECT',
    url: serverHost,
    headers: {
      'connection': 'close',
      'proxy-connection': 'keep-alive',
      'host': serverHost,
    },
  });

  logs.splice(0, logs.length);
}

// --fetch-env-proxy does NOT enable proxy for http.request().
{
  const { code, signal, stderr, stdout } = await runProxiedRequest({
    REQUEST_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
  }, ['--fetch-env-proxy']);
  assert.strictEqual(stderr.trim(), '');
  assert.match(stdout, /Hello world/);
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
  // No proxy logs — http.request() should NOT be proxied.
  assert.strictEqual(logs.length, 0);
}

// NODE_FETCH_ENV_PROXY=1 does NOT enable proxy for http.request().
{
  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_FETCH_ENV_PROXY: '1',
    REQUEST_URL: requestUrl,
    HTTP_PROXY: `http://localhost:${proxy.address().port}`,
  });
  assert.strictEqual(stderr.trim(), '');
  assert.match(stdout, /Hello world/);
  assert.strictEqual(code, 0);
  assert.strictEqual(signal, null);
  // No proxy logs — http.request() should NOT be proxied.
  assert.strictEqual(logs.length, 0);
}

server.close();
proxy.close();
