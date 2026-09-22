// This tests that an attach session without --max-hit ends at --timeout with
// exit 0 and a `timeout` terminal. In launch mode a timeout is a failure.
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
    '--probe', 'probe-attach-loop.js:9',
    '--expr', 'count',
    '--attach', `${host}:${port}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  child.kill();

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  const hits = report.results.slice(0, -1);
  assert.ok(hits.length > 0, 'expected at least one hit before the timeout');
  for (const hit of hits) {
    assert.strictEqual(hit.event, 'hit');
  }
  const terminal = report.results[report.results.length - 1];
  assert.strictEqual(terminal.event, 'timeout');
  assert.deepStrictEqual(terminal.pending, []);
  assert.strictEqual(terminal.error.code, 'probe_timeout');
}

main().then(common.mustCall());
