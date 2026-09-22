// This tests that a probe expression still running when the attach --timeout
// deadline passes gets a short grace period. When it never finishes, the
// session reports a probe failure with a synthetic hit and exits 1. The
// target is left executing the expression because it is not ours to stop,
// so the test kills it.
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

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--timeout', '500',
    '--probe', 'probe-attach-loop.js:9',
    '--expr', 'while (true) {}',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  // The target is stuck inside the evaluation and will not exit on its own.
  child.kill('SIGKILL');
  await exited;

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 1);

  const report = JSON.parse(stdout);
  assert.strictEqual(report.results.length, 2);

  const hit = report.results[0];
  assert.strictEqual(hit.event, 'hit');
  assert.strictEqual(hit.probe, 0);
  assert.strictEqual(hit.hit, 1);
  assert.strictEqual(hit.error.message, 'Probe evaluation did not complete');

  const terminal = report.results[1];
  assert.strictEqual(terminal.event, 'error');
  assert.deepStrictEqual(terminal.pending, []);
  assert.strictEqual(terminal.error.code, 'probe_failure');
  assert.strictEqual(terminal.error.probe, 0);
  assert.match(terminal.error.message, /Probe session timed out/);
  assert.match(terminal.error.message, /the target may still be executing it/);
}

main().then(common.mustCall());
