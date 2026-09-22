// This tests that an attach session ends with `completed` as soon as the
// probed target finishes on its own, instead of holding the target until
// --timeout, and that the target is then allowed to exit normally.
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

  const startedAt = Date.now();
  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--timeout', '10000',
    // Line 9 ticks every 50ms until the target stops its timer and exits.
    '--probe', 'probe-attach-finishes.js:9',
    '--expr', 'count',
    '--host', host,
    '--port', `${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });
  const elapsed = Date.now() - startedAt;

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  // The target finishes about 2 seconds in, well before the 10 second
  // deadline. The session must end with the target, not with the deadline.
  assert.ok(elapsed < 5000, `session took ${elapsed}ms, expected well under the timeout`);

  const report = JSON.parse(stdout);
  const hits = report.results.slice(0, -1);
  assert.ok(hits.length > 0, 'expected at least one hit before the target finished');
  for (const hit of hits) {
    assert.strictEqual(hit.event, 'hit');
  }
  assert.deepStrictEqual(report.results[report.results.length - 1], { event: 'completed' });

  // Detaching must let the target exit on its own, with success.
  const { code: targetCode, signal: targetSignal } = await exited;
  assert.strictEqual(targetSignal, null);
  assert.strictEqual(targetCode, 0);
}

main().then(common.mustCall());
