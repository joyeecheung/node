'use strict';

// This tests that invalid proxy URLs are handled correctly for HTTPS requests.
const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const assert = require('assert');
const { once } = require('events');
const https = require('https');
const { runProxiedRequest } = require('../common/proxy-server');

(async () => {
  const server = https.createServer({
    cert: fixtures.readKey('agent8-cert.pem'),
    key: fixtures.readKey('agent8-key.pem'),
  }, common.mustNotCall());
  server.on('error', common.mustNotCall((err) => { console.error('Server error', err); }));
  server.listen(0);
  await once(server, 'listening');

  const serverHost = `localhost:${server.address().port}`;
  const requestUrl = `https://${serverHost}/test`;

  // Test invalid proxy URL
  const { code, signal, stderr, stdout } = await runProxiedRequest({
    NODE_USE_ENV_PROXY: 1,
    REQUEST_URL: requestUrl,
    HTTPS_PROXY: 'not-a-valid-url',
    NODE_EXTRA_CA_CERTS: fixtures.path('keys', 'fake-startcom-root-cert.pem'),
  });

  // Should get an error about invalid URL
  assert.match(stderr, /TypeError.*Invalid URL/);
  assert.strictEqual(stdout.trim(), '');
  assert.strictEqual(code, 1);
  assert.strictEqual(signal, null);

  server.close();
})().then(common.mustCall());
