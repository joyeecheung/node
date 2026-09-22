// This tests that probe mode can attach to a running process via --pid,
// activating its inspector, evaluating a probe, and finishing with `completed`
// once --max-hit is reached, leaving the target running.
//
// It lives in sequential/ because it relies on a fixed inspector port
// (common.PORT), which cannot be used from a parallelized test.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { startAttachTarget } = require('../common/debugger-probe');

const fixture = fixtures.path('debugger', 'probe-attach-loop.js');
const fixtureUrl = fixtures.fileURL('debugger', 'probe-attach-loop.js').href;

async function main() {
  // The inspector is not enabled until --pid signals the target. --inspect-port
  // sets the port it will listen on so the probe knows where to connect.
  const { child, exited } = await startAttachTarget(
    [`--inspect-port=${common.PORT}`], fixture);

  let exitedEarly = false;
  exited.then(common.mustCall(() => { exitedEarly = true; }));

  const { code, signal, stdout } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--probe', 'probe-attach-loop.js:9',
    '--expr', 'count',
    '--max-hit', '1',
    '--pid', `${child.pid}`,
    '--port', `${common.PORT}`,
  ], { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });

  assert.strictEqual(signal, null);
  assert.strictEqual(code, 0);

  const report = JSON.parse(stdout);
  assert.deepStrictEqual(report.target,
                         { pid: child.pid, host: '127.0.0.1', port: common.PORT });
  assert.strictEqual(report.results.length, 2);
  const hit = report.results[0];
  assert.strictEqual(hit.event, 'hit');
  assert.deepStrictEqual(hit.location, { url: fixtureUrl, line: 9, column: 3 });
  assert.deepStrictEqual(report.results[1], { event: 'completed' });

  // The target is not ours, so it must still be running after we detach.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(exitedEarly, false);

  child.kill();
  await exited;
}

main().then(common.mustCall());
