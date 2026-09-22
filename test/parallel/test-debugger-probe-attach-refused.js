// This tests that attaching to a port where nothing is listening fails with a
// clean startup error on stderr, no report, and exit 1.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const net = require('net');

async function main() {
  // Bind and close a server to get a port that is (very likely) free.
  const freePort = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

  const { code, signal, stdout, stderr } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--probe', 'whatever.js:1',
    '--expr', '1',
    '--port', `${freePort}`,
  ]);

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 1);
  assert.strictEqual(stdout, '');
  assert.match(stderr, /Could not attach to 127\.0\.0\.1:/);
}

main().then(common.mustCall());
