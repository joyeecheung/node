'use strict';

// This tests that tls.setDefaultCACertificates() properly overrides certificates
// added through NODE_EXTRA_CA_CERTS environment variable.

const common = require('../common');
if (!common.hasCrypto) common.skip('missing crypto');

const fixtures = require('../common/fixtures');
const { spawnSyncAndAssert } = require('../common/child_process');

// Test that extra CA certificates can be overridden
{
  const extraCAPath = fixtures.path('keys', 'fake-startcom-root-cert.pem');
  const testScript = fixtures.path('tls-extra-ca-basic-override.js');
  
  spawnSyncAndAssert(process.execPath, [testScript], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: extraCAPath }
  }, {
    stdout: 'SUCCESS: All tests passed\n'
  });
}

// Test that extra CA certificates can be restored
{
  const extraCAPath = fixtures.path('keys', 'fake-startcom-root-cert.pem');
  const testScript = fixtures.path('tls-extra-ca-restore.js');
  
  spawnSyncAndAssert(process.execPath, [testScript], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: extraCAPath }
  }, {
    stdout: 'SUCCESS: All tests passed\n'
  });
}

// Test that overriding defaults doesn't affect extra cert type
{
  const extraCAPath = fixtures.path('keys', 'fake-startcom-root-cert.pem');
  const testScript = fixtures.path('tls-extra-ca-isolation.js');
  
  spawnSyncAndAssert(process.execPath, [testScript], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: extraCAPath }
  }, {
    stdout: 'SUCCESS: All isolation tests passed\n'
  });
}