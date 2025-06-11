'use strict';

// This tests that when the proxy server doesn't respond to CONNECT in time,
// the client respects the agent timeout setting.
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const assert = require('assert');
const { once } = require('events');
const https = require('https');
const http = require('http');

(async () => {
  const server = https.createServer({
    cert: fixtures.readKey('agent8-cert.pem'),
    key: fixtures.readKey('agent8-key.pem'),
  }, common.mustNotCall());
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  // Start a proxy server that accepts CONNECT but never responds.
  const proxy = http.createServer();
  proxy.on('connect', common.mustCall((req, res) => {
    // Don't respond - just hang to simulate timeout
  }, 1));
  proxy.listen(0);
  await once(proxy, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;

  // Set NODE_USE_ENV_PROXY
  process.env.NODE_USE_ENV_PROXY = '1';
  process.env.HTTPS_PROXY = `http://localhost:${proxy.address().port}`;

  // Create agent with timeout
  const agent = new https.Agent({
    timeout: 800, // 800ms timeout
  });

  const startTime = Date.now();
  const req = https.get(requestUrl, {
    agent: agent,
    ca: fixtures.readKey('fake-startcom-root-cert.pem'),
  }, common.mustNotCall());

  req.on('error', common.mustCall((err) => {
    // Should be a proxy error about timeout
    assert.strictEqual(err.code, 'ERR_PROXY_ERROR');
    assert.match(err.message, /Connection to establish proxy tunnel timed out/);
    
    proxy.close();
    server.close();
  }));

  req.end();
})().then(common.mustCall());