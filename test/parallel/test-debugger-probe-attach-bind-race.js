// This tests that a target pausing at a breakpoint while the session is still binding the next one
// does not break the session. The pause is handled once all the probes are bound.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { runAttachedProbe } = require('../common/debugger-probe');

// Line 8 runs continuously, so its breakpoint pauses the target before line 13 is bound.
runAttachedProbe('probe-attach-busy.js', [
  '--probe', 'probe-attach-busy.js:8', '--expr', 'typeof count', '--max-hit', '1',
  '--probe', 'probe-attach-busy.js:13', '--expr', '1',
], {
  status: 0,
  report: {
    v: 2,
    probes: [
      { expr: 'typeof count', target: { suffix: 'probe-attach-busy.js', line: 8 }, maxHit: 1 },
      { expr: '1', target: { suffix: 'probe-attach-busy.js', line: 13 } },
    ],
    results: [{
      probe: 0, event: 'hit', hit: 1, result: { type: 'string', value: 'number' },
      location: { url: fixtures.fileURL('debugger', 'probe-attach-busy.js').href, line: 8, column: 3 },
    }, { event: 'completed' }],
  },
}).then(common.mustCall());
