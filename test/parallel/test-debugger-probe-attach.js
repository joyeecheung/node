// This tests a --host/--port attach session hitting a probe in a script loaded before it attached,
// and ending at --max-hit. The target keeps running, so a second session can attach to it. Killing
// the target during that session is reported as a probe failure, because without --pid an exit
// cannot be distinguished from a network failure.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { runProbe, startTarget } = require('../common/debugger-probe');

const url = fixtures.fileURL('debugger', 'probe-attach-loop.js').href;
const location = { url, line: 9, column: 3 };
const hit = (n) => ({ probe: 0, event: 'hit', hit: n, location, result: { type: 'string', value: 'number' } });

async function main() {
  const target = await startTarget('probe-attach-loop.js');
  const attachArgs = ['--host', target.host, '--port', `${target.port}`];
  await runProbe(['--probe', 'probe-attach-loop.js:9', '--expr', 'typeof count', '--max-hit', '2', ...attachArgs], {
    target,
    status: 0,
    report: {
      v: 2,
      target: { host: target.host, port: target.port },
      probes: [{
        expr: 'typeof count', target: { suffix: 'probe-attach-loop.js', line: 9 }, maxHit: 2, locations: [location],
      }],
      results: [hit(1), hit(2), { event: 'completed' }],
    },
  });

  // Line 14 only runs at startup, so this session waits until the target is killed.
  await runProbe(['--probe', 'probe-attach-loop.js:14', '--expr', '1', ...attachArgs], {
    target,
    onStarted: () => target.child.kill('SIGKILL'),
    status: 1,
    report: {
      v: 2,
      probes: [{
        expr: '1', target: { suffix: 'probe-attach-loop.js', line: 14 }, locations: [{ url, line: 14, column: 1 }],
      }],
      results: [{
        event: 'error',
        pending: [0],
        error: {
          code: 'probe_failure',
          message: 'Inspector connection lost before probes: probe-attach-loop.js:14. The target was likely ' +
            "terminated externally. If the failure persists, check the target's process environment.",
        },
      }],
    },
  });
  await target.exited;
}

main().then(common.mustCall());
