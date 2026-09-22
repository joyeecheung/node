// This tests that probe mode can attach to an already-running process via
// --attach <host>:<port>, evaluate a probe against a pre-existing script, and
// finish with `completed` once --max-hit is reached.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-loop.js');
const fixtureUrl = fixtures.fileURL('debugger', 'probe-attach-loop.js').href;

async function main() {
  const { child, host, port } = await startAttachTarget(
    ['--inspect=127.0.0.1:0'], fixture);

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--probe', 'probe-attach-loop.js:9',
    '--expr', 'count',
    '--max-hit', '2',
    '--attach', `${host}:${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  child.kill();

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  assert.strictEqual(report.v, 2);
  assert.deepStrictEqual(report.target, { host, port });
  assert.deepStrictEqual(report.probes, [
    { expr: 'count', target: { suffix: 'probe-attach-loop.js', line: 9 }, maxHit: 2 },
  ]);

  const hits = report.results.slice(0, -1);
  assert.strictEqual(hits.length, 2);
  for (let i = 0; i < hits.length; i++) {
    assert.strictEqual(hits[i].event, 'hit');
    assert.strictEqual(hits[i].probe, 0);
    assert.strictEqual(hits[i].hit, i + 1);
    assert.deepStrictEqual(hits[i].location, { url: fixtureUrl, line: 9, column: 3 });
    // The target has been ticking since before we attached, so the counter is
    // already non-zero. This confirms the probe bound to an already-loaded
    // script.
    assert.strictEqual(hits[i].result.type, 'number');
  }
  assert.deepStrictEqual(report.results[report.results.length - 1], { event: 'completed' });
}

main().then(common.mustCall());
