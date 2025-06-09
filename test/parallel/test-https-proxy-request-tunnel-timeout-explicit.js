'use strict';

// This tests that when the proxy server doesn't respond to CONNECT in time,
// the client respects the timeout setting and times out correctly.
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

  // Set NODE_USE_ENV_PROXY and test with explicit timeout
  process.env.NODE_USE_ENV_PROXY = '1';
  process.env.HTTPS_PROXY = `http://localhost:${proxy.address().port}`;

  // Create an agent that will use the proxy
  const agent = new https.Agent();

  const startTime = Date.now();
  const req = https.get(requestUrl, {
    timeout: 1000, // 1 second timeout
    agent: agent,
    ca: fixtures.readKey('fake-startcom-root-cert.pem'),
  }, common.mustNotCall());

  req.on('error', common.mustCall((err) => {
    const elapsed = Date.now() - startTime;
    
    // Should timeout within reasonable bounds (1000ms ± 200ms for some tolerance)
    assert(elapsed >= 900 && elapsed <= 1200, 
           `Timeout took ${elapsed}ms, expected around 1000ms`);
    
    // Should be a proxy error about timeout
    assert.strictEqual(err.code, 'ERR_PROXY_ERROR');
    assert(err.message.includes('timed out'), 
           `Expected timeout message, got: ${err.message}`);
    
    proxy.close();
    server.close();
  }));

  req.end();
})().then(common.mustCall());