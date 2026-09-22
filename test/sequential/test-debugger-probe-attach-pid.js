// This tests a --pid attach session, which activates the target's inspector, ending at --max-hit.
// The target keeps running, so a second session can attach to it. Killing the target during that
// session is reported as probe_target_exit with exit 0, as in launch mode, because with --pid the
// session can confirm that the process is gone.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { runProbe, startTarget } = require('../common/debugger-probe');

async function main() {
  const target = await startTarget('probe-attach-loop.js', [`--inspect-port=${common.PORT}`]);
  const { pid } = target.child;
  const attachArgs = ['--pid', `${pid}`, '--port', `${common.PORT}`];
  await runProbe(['--probe', 'probe-attach-loop.js:9', '--expr', 'typeof count', '--max-hit', '1', ...attachArgs], {
    target,
    status: 0,
    report: {
      v: 2,
      target: { pid, host: '127.0.0.1', port: common.PORT },
      probes: [{ expr: 'typeof count', target: { suffix: 'probe-attach-loop.js', line: 9 }, maxHit: 1 }],
      results: [{
        probe: 0, event: 'hit', hit: 1, result: { type: 'string', value: 'number' },
        location: { url: fixtures.fileURL('debugger', 'probe-attach-loop.js').href, line: 9, column: 3 },
      }, { event: 'completed' }],
    },
  });

  // Line 14 only runs at startup, so this session waits until the target is killed.
  await runProbe(['--probe', 'probe-attach-loop.js:14', '--expr', '1', ...attachArgs], {
    target,
    onStarted: () => target.child.kill('SIGKILL'),
    status: 0,
    report: {
      v: 2,
      probes: [{ expr: '1', target: { suffix: 'probe-attach-loop.js', line: 14 } }],
      results: [{
        event: 'error',
        pending: [0],
        error: {
          code: 'probe_target_exit',
          message: `Target process ${pid} exited before probes: probe-attach-loop.js:14`,
        },
      }],
    },
  });
  await target.exited;
}

main().then(common.mustCall());
