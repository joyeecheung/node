// This tests that attaching to a target parked at --inspect-brk releases it
// via Runtime.runIfWaitingForDebugger, so its code starts running and probes
// can hit. The first hit observes the counter before the first increment.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-loop.js');

async function main() {
  const { child, host, port } = await startAttachTarget(
    ['--inspect-brk=127.0.0.1:0'], fixture, { waitForListening: true });

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--probe', 'probe-attach-loop.js:9',
    '--expr', 'count',
    '--max-hit', '1',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  child.kill();

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  assert.strictEqual(report.results.length, 2);
  const hit = report.results[0];
  assert.strictEqual(hit.event, 'hit');
  assert.strictEqual(hit.probe, 0);
  // The target had not run when the session attached, so the first hit
  // observes the counter before the first increment.
  assert.strictEqual(hit.result.value, 0);
  assert.deepStrictEqual(report.results[1], { event: 'completed' });
}

main().then(common.mustCall());
