// This tests that killing the target mid-session is reported as a structured
// probe failure through the inspector disconnect path, with exit 1, and that
// teardown does not stall sending requests on the closed connection.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-loop.js');

async function main() {
  const { child, host, port, exited } = await startAttachTarget(
    ['--inspect=127.0.0.1:0'], fixture);

  // Kill the target shortly after the probe session attaches, while it is
  // waiting on a probe that never hits (line 13 runs only at startup).
  setTimeout(() => child.kill('SIGKILL'), 500);

  let targetExitedAt;
  exited.then(common.mustCall(() => { targetExitedAt = Date.now(); }));

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--timeout', '30000',
    '--probe', 'probe-attach-loop.js:13',
    '--expr', '1',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });
  const probeEndedAt = Date.now();

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 1);

  // Teardown must skip Debugger.resume on the closed connection instead of
  // stalling on its 2000ms reply timeout, so the probing process ends well
  // within 2 seconds of the target dying.
  assert.ok(probeEndedAt - targetExitedAt < 1500,
            `teardown took ${probeEndedAt - targetExitedAt}ms after the kill`);

  const report = JSON.parse(stdout);
  const terminal = report.results[report.results.length - 1];
  assert.strictEqual(terminal.event, 'error');
  assert.strictEqual(terminal.error.code, 'probe_failure');
  // The target's stderr is not observable in attach mode.
  assert.strictEqual(terminal.error.stderr, undefined);
}

main().then(common.mustCall());
