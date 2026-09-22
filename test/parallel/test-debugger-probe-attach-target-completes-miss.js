// This tests that when the probed target finishes on its own while some
// probes never hit, the attach session ends with `miss` listing them as
// pending, exit 0, and the target is allowed to exit normally.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-finishes.js');

async function main() {
  const { host, port, exited } = await startAttachTarget(
    ['--inspect=127.0.0.1:0'], fixture);

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--timeout', '10000',
    // Line 18 (console.log) runs once at startup, before we attach, and never
    // again, so the probe binds but never hits.
    '--probe', 'probe-attach-finishes.js:18',
    '--expr', '1',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  assert.deepStrictEqual(report.results, [{ event: 'miss', pending: [0] }]);

  // Detaching must let the target exit on its own, with success.
  const { code: targetCode, signal: targetSignal } = await exited;
  assert.strictEqual(targetSignal, null);
  assert.strictEqual(targetCode, 0);
}

main().then(common.mustCall());
