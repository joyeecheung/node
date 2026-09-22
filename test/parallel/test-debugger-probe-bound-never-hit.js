// Tests that probing an unreachable line produces a `miss` with no hit events.
// The probe did bind, so its resolved location is reported, which
// distinguishes it from a probe that matched no script at all.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { spawnSyncAndAssert } = require('../common/child_process');
const { assertProbeJson } = require('../common/debugger-probe');

const cwd = fixtures.path('debugger');
const fixtureUrl = fixtures.fileURL('debugger', 'probe-bound-never-hit.js').href;

spawnSyncAndAssert(process.execPath, [
  'inspect',
  '--json',
  '--probe', 'probe-bound-never-hit.js:4',
  '--expr', '1',
  'probe-bound-never-hit.js',
], { cwd, env: { ...process.env, NODE_DEBUG: 'inspect_probe' } }, {
  stdout(output) {
    assertProbeJson(output, {
      v: 2,
      probes: [{
        expr: '1',
        target: { suffix: 'probe-bound-never-hit.js', line: 4 },
        locations: [{ url: fixtureUrl, line: 4, column: 3 }],
      }],
      results: [{
        event: 'miss',
        pending: [0],
      }],
    });
  },
  trim: true,
});
