// This tests the precedence and interaction between --fetch-env-proxy,
// NODE_FETCH_ENV_PROXY, --use-env-proxy, and --no-use-env-proxy.

import * as common from '../common/index.mjs';
import assert from 'node:assert';
import http from 'node:http';
import { once } from 'events';
import { createProxyServer, checkProxiedFetch } from '../common/proxy-server.js';

// Start a proxy server for testing.
const { proxy, logs } = createProxyServer();
proxy.listen(0);
await once(proxy, 'listening');

// Start a HTTP server to process the final request.
const server = http.createServer(common.mustCall((req, res) => {
  res.end('Hello world');
}, 4));
server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
server.listen(0);
await once(server, 'listening');

const serverHost = `localhost:${server.address().port}`;
const requestUrl = `http://${serverHost}/test`;
const proxyUrl = `http://localhost:${proxy.address().port}`;

delete process.env.NODE_USE_ENV_PROXY;
delete process.env.NODE_FETCH_ENV_PROXY;

// --use-env-proxy implies --fetch-env-proxy: fetch() is proxied.
{
  await checkProxiedFetch({
    FETCH_URL: requestUrl,
    HTTP_PROXY: proxyUrl,
  }, {
    stdout: 'Hello world',
  }, ['--use-env-proxy']);

  assert.strictEqual(logs.length, 1);
  logs.splice(0, logs.length);
}

// --fetch-env-proxy and --no-fetch-env-proxy cancel out (last wins): no proxy.
{
  await checkProxiedFetch({
    FETCH_URL: requestUrl,
    HTTP_PROXY: proxyUrl,
  }, {
    stdout: 'Hello world',
  }, ['--fetch-env-proxy', '--no-fetch-env-proxy']);

  // Should NOT use the proxy.
  assert.strictEqual(logs.length, 0);
}

// --use-env-proxy implies --fetch-env-proxy, so --no-fetch-env-proxy alone
// cannot override it when --use-env-proxy is present.
{
  await checkProxiedFetch({
    FETCH_URL: requestUrl,
    HTTP_PROXY: proxyUrl,
  }, {
    stdout: 'Hello world',
  }, ['--no-fetch-env-proxy', '--use-env-proxy']);

  // Should use the proxy because --use-env-proxy implies --fetch-env-proxy.
  assert.strictEqual(logs.length, 1);
  logs.splice(0, logs.length);
}

// --no-use-env-proxy disables fetch proxy even when NODE_FETCH_ENV_PROXY=1.
{
  await checkProxiedFetch({
    NODE_FETCH_ENV_PROXY: '1',
    FETCH_URL: requestUrl,
    HTTP_PROXY: proxyUrl,
  }, {
    stdout: 'Hello world',
  }, ['--no-use-env-proxy']);

  // Should NOT use the proxy.
  assert.strictEqual(logs.length, 0);
}

server.close();
proxy.close();
