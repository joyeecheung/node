// This tests that an attach session ends as soon as the target finishes on its own, instead of at
// --timeout, and that the target then exits normally. Probes that never hit are reported as missed.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fixtures = require('../common/fixtures');
const { runProbe, startTarget } = require('../common/debugger-probe');

async function main() {
  const target = await startTarget('probe-attach-finishes.js');
  // Closing its stdin makes the target run line 7 once and exit. Line 12 only runs at startup.
  await runProbe([
    '--probe', 'probe-attach-finishes.js:7', '--expr', 'count',
    '--probe', 'probe-attach-finishes.js:12', '--expr', '1',
    '--host', target.host, '--port', `${target.port}`,
  ], {
    target,
    onStarted: () => target.child.stdin.end(),
    status: 0,
    report: {
      v: 2,
      probes: [
        { expr: 'count', target: { suffix: 'probe-attach-finishes.js', line: 7 } },
        { expr: '1', target: { suffix: 'probe-attach-finishes.js', line: 12 } },
      ],
      results: [{
        probe: 0, event: 'hit', hit: 1, result: { type: 'number', value: 0, description: '0' },
        location: { url: fixtures.fileURL('debugger', 'probe-attach-finishes.js').href, line: 7, column: 3 },
      }, { event: 'miss', pending: [1] }],
    },
  });
  assert.deepStrictEqual(await target.exited, { code: 0, signal: null });
}

main().then(common.mustCall());
