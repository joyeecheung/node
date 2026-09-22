// This tests that an attach session whose probe never executes ends at
// --timeout with a `timeout` terminal listing the probe as pending, exit 0.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-loop.js');

async function main() {
  const { child, host, port } = await startAttachTarget(
    ['--inspect=127.0.0.1:0'], fixture);

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--timeout', '1000',
    // Line 13 (console.log) runs once at startup, before we attach, and never
    // again, so the probe binds but never hits.
    '--probe', 'probe-attach-loop.js:13',
    '--expr', '1',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  child.kill();

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  assert.deepStrictEqual(report.results, [{
    event: 'timeout',
    pending: [0],
    error: {
      code: 'probe_timeout',
      message: 'Session timed out after 1000ms, detaching from the target',
    },
  }]);
}

main().then(common.mustCall());
