// This tests that a target pausing at an already-bound breakpoint while the
// attach session is still binding another does not break the session. The
// pause is queued until startup completes, so probe evaluation never overlaps
// with the remaining setup calls.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-two-timers.js');

async function main() {
  const { child, host, port } = await startAttachTarget(
    ['--inspect=127.0.0.1:0'], fixture);

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    // Both lines tick every 5ms, so the first breakpoint can pause the target
    // while the second is still being bound.
    '--probe', 'probe-attach-two-timers.js:10',
    '--expr', 'a',
    '--max-hit', '1',
    '--probe', 'probe-attach-two-timers.js:14',
    '--expr', 'b',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  child.kill();

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  const hits = report.results.slice(0, -1);
  assert.ok(hits.length > 0, 'expected at least one hit');
  const firstProbeHits = hits.filter((hit) => hit.probe === 0);
  assert.strictEqual(firstProbeHits.length, 1);
  assert.deepStrictEqual(report.results[report.results.length - 1], { event: 'completed' });
}

main().then(common.mustCall());
