'use strict';

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const assert = require('assert');
const { once } = require('events');
const https = require('https');
const { createProxyServer, runProxiedRequest } = require('../common/proxy-server');

(async () => {
  // Start a server to process the final request.
  const server = https.createServer({
    cert: fixtures.readKey('agent8-cert.pem'),
    key: fixtures.readKey('agent8-key.pem'),
  }, common.mustCall((req, res) => {
    res.end('Hello world');
  }, 2));
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  // Start a minimal proxy server.
  const { proxy, logs } = createProxyServer();
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;
  const expectedLogs = [{
    method: 'CONNECT',
    url: serverHost,
    headers: {
      'proxy-connection': 'keep-alive',
      'host': serverHost
    }
  }];

  // Check upper-cased HTTPS_PROXY environment variable.
  {
    const { code, signal, stderr, stdout } = await runProxiedRequest({
      NODE_USE_ENV_PROXY: 1,
      REQUEST_URL: requestUrl,
      HTTPS_PROXY: `http://localhost:${proxy.address().port}`,
      NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
    });
    assert.deepStrictEqual(logs, expectedLogs);
    assert.strictEqual(stderr.trim(), '');
    assert.match(stdout, /Hello world/);
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
  }

  // Check lower-cased https_proxy environment variable.
  {
    logs.splice(0, logs.length);
    const { code, signal, stderr, stdout } = await runProxiedRequest({
      NODE_USE_ENV_PROXY: 1,
      REQUEST_URL: requestUrl,
      https_proxy: `http://localhost:${proxy.address().port}`,
      NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
    });
    assert.deepStrictEqual(logs, expectedLogs);
    assert.strictEqual(stderr.trim(), '');
    assert.match(stdout, /Hello world/);
    assert.strictEqual(code, 0);
    assert.strictEqual(signal, null);
  }

  proxy.close();
  server.close();
})().then(common.mustCall());
