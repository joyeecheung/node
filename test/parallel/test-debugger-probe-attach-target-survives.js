// This tests that the target keeps running after a probe attach session ends.
// Teardown must resume and detach instead of killing a process it does not own.
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

  const exited = new Promise((resolve) => child.once('exit', resolve));
  let exitedEarly = false;
  exited.then(() => { exitedEarly = true; });

  const { code } = await common.spawnPromisified(process.execPath, [
    'inspect',
    '--json',
    '--probe', 'probe-attach-loop.js:9',
    '--expr', 'count',
    '--max-hit', '1',
    '--attach', `${host}:${port}`,
  ]);
  assert.strictEqual(code, 0);

  // Give any erroneous teardown a chance to take the target down.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(exitedEarly, false, 'the attach target should still be running');
  assert.strictEqual(child.killed, false);

  child.kill();
  await exited;
}

main().then(common.mustCall());
