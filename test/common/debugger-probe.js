'use strict';

const assert = require('assert');
const { spawn } = require('child_process');
const { once } = require('events');
const { checkOutput, spawnSyncAndExit } = require('./child_process');
const fixtures = require('./fixtures');

const kListeningRegex = /Debugger listening on ws:\/\/\[?(.+?)\]?:(\d+)\//;
// Logged by the probe session with NODE_DEBUG=inspect_probe once its probes are bound.
const kStartedLine = 'CDP <- Runtime.runIfWaitingForDebugger';

function logProcessOutput(tag, { child, stdout, stderr }) {
  console.error(`${tag} --- stderr ---`);
  console.error(stderr);
  console.error(`${tag} --- stdout ---`);
  console.error(stdout);
  console.error(`${tag} status = ${child.exitCode}, signal = ${child.signalCode}`);
}

// Starts test/fixtures/debugger/<name> and resolves once it prints `ready`. The returned target keeps
// collecting the output of the process, so it can be printed when a probe session fails.
function startTarget(name, args = ['--inspect=127.0.0.1:0']) {
  const child = spawn(process.execPath, [...args, fixtures.path('debugger', name)]);
  // A failed assertion must not leave a long-running target behind.
  process.on('exit', () => child.kill());
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const target = {
    child,
    stdout: '',
    stderr: '',
    exited: once(child, 'exit').then(([code, signal]) => ({ code, signal })),
  };
  return new Promise((resolve, reject) => {
    let ready = false;
    function check() {
      if (ready || !target.stdout.includes('ready')) { return; }
      ready = true;
      const match = kListeningRegex.exec(target.stderr);
      target.host = match?.[1];
      target.port = match && Number(match[2]);
      child.removeListener('exit', onExit);
      resolve(target);
    }

    function onExit() {
      logProcessOutput(`[target ${child.pid}]:`, target);
      reject(new Error(`Target ${name} exited before it was ready`));
    }
    child.stdout.on('data', (chunk) => { target.stdout += chunk; check(); });
    child.stderr.on('data', (chunk) => { target.stderr += chunk; check(); });
    child.once('exit', onExit);
  });
}

// Runs `node inspect --json <args>` and checks its exit `status`, its JSON `report` (through assertProbeJson,
// or null when none is expected) and optionally its `stderr` (a string, RegExp or function). On failure it
// prints the output of the probe process and of `target`, if given, like the helpers in ./child_process.
// `onStarted` is called once the probes are bound.
async function runProbe(args, { target, onStarted, status, report: expectedReport, stderr: stderrCheck }) {
  const argv = ['inspect', '--json', ...args];
  const child = spawn(process.execPath, argv, { env: { ...process.env, NODE_DEBUG: 'inspect_probe' } });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const probe = { child, stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { probe.stdout += chunk; });
  child.stderr.on('data', (chunk) => {
    probe.stderr += chunk;
    if (onStarted !== undefined && probe.stderr.includes(kStartedLine)) {
      onStarted(target);
      onStarted = undefined;
    }
  });
  // Unlike 'exit', 'close' fires after stdout and stderr are fully read.
  const [code] = await once(child, 'close');

  const failures = [];
  if (code !== status) {
    failures.push(`- probe process exited with status ${code}, expected ${status}`);
  }
  let report = null;
  if (probe.stdout !== '') {
    try {
      report = JSON.parse(probe.stdout);
    } catch {
      failures.push('- stdout is not a JSON report');
    }
  }
  if (expectedReport === null) {
    if (report !== null) { failures.push('- expected no report'); }
  } else if (report === null) {
    failures.push('- no report was printed');
  } else {
    try {
      assertProbeJson(report, expectedReport);
    } catch (error) {
      failures.push(`- report did not match:\n${error.message}`);
    }
  }
  if (stderrCheck !== undefined) {
    const { passed, reason } = checkOutput(probe.stderr, stderrCheck);
    if (!passed) { failures.push(`- stderr ${reason}`); }
  }
  if (failures.length === 0) { return { report, stderr: probe.stderr }; }

  logProcessOutput(`[probe ${child.pid}]:`, probe);
  if (target !== undefined) { logProcessOutput(`[target ${target.child.pid}]:`, target); }
  const error = new Error(failures.join('\n'));
  error.command = `${process.execPath} ${argv.join(' ')}`;
  throw error;
}

// Starts test/fixtures/debugger/<name>, runs `node inspect` against its --host and --port with the same
// expectations as runProbe(), and kills it afterwards. Use startTarget() and runProbe() directly to run
// several sessions against one target.
async function runAttachedProbe(name, probeArgs, { targetArgs, ...options } = {}) {
  const target = await startTarget(name, targetArgs);
  const result = await runProbe([...probeArgs, '--host', target.host, '--port', `${target.port}`],
                                { ...options, target });
  target.child.kill();
  await target.exited;
  return result;
}

// Work around a pre-existing inspector issue: if the debuggee exits too quickly
// the inspector can crash while tearing down. For now normalize the crash
// back to the expected terminal event (e.g. "completed" or "miss")
// until the upstream bug is fixed.
// See https://github.com/nodejs/node/issues/62765
// https://github.com/nodejs/node/issues/58245
// The crash shows up as with exit code 3221225477 on Windows, or signal
// SIGSEGV on other platforms.
const probeTargetExitSignal = 'SIGSEGV';
// 0xC0000005 STATUS_ACCESS_VIOLATION on Windows
const probeTargetExitCode = 3221225477;

function isProbeSegvTeardown(result) {
  if (result?.event !== 'error') { return false; }
  const error = result.error;
  if (error?.signal !== probeTargetExitSignal && error?.exitCode !== probeTargetExitCode) { return false; }
  return error.code === 'probe_target_exit' || error.code === 'probe_failure';
}

function findProbeSegvTeardownLine(output) {
  const signalPrefix = `Target exited with signal ${probeTargetExitSignal}`;
  const codePrefix = `Target exited with code ${probeTargetExitCode}`;
  for (const prefix of [signalPrefix, codePrefix]) {
    if (output.startsWith(prefix)) { return 0; }
    const idx = output.indexOf(`\n${prefix}`);
    if (idx !== -1) { return idx + 1; }
  }
  return -1;
}

// Replace volatile fields in a probe report (stack frames, Node.js version,
// scriptId, callFrames) with stable placeholders for deepStrictEqual.
function normalizeProbeReport(value) {
  if (typeof value === 'string') {
    return value
      .replace(/(?:\n[ \t]+at\s[^\n]*)+/g, '\n<stack>')
      .replace(/\nNode\.js v[^\n]+/g, '\nNode.js <version>');
  }
  if (Array.isArray(value)) {
    return value.map(normalizeProbeReport);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      if (key === 'scriptId') {
        result[key] = '<scriptId>';
      } else if (key === 'callFrames') {
        result[key] = '<callFrames>';
      } else {
        result[key] = normalizeProbeReport(value[key]);
      }
    }
    return result;
  }
  return value;
}

// A `target` or probe `locations` that `expected` omits is only checked for presence.
function assertProbeJson(output, expected) {
  const normalized = typeof output === 'string' ? JSON.parse(output) : output;
  const lastResult = normalized.results?.[normalized.results.length - 1];

  if (isProbeSegvTeardown(lastResult)) {
    // Log to facilitate debugging if this normalization is occurring.
    console.log('Normalizing trailing SIGSEGV in JSON probe output');
    normalized.results[normalized.results.length - 1] = expected.results.at(-1);
  }

  if (!Object.hasOwn(expected, 'target')) {
    assert.notStrictEqual(normalized.target, undefined);
    delete normalized.target;
  }
  if (Array.isArray(normalized.probes) && Array.isArray(expected.probes)) {
    for (let i = 0; i < normalized.probes.length; i++) {
      if (expected.probes[i] !== undefined && !Object.hasOwn(expected.probes[i], 'locations')) {
        assert.strictEqual(Array.isArray(normalized.probes[i].locations), true,
                           `probes[${i}].locations must be an array`);
        delete normalized.probes[i].locations;
      }
    }
  }

  assert.deepStrictEqual(normalizeProbeReport(normalized), normalizeProbeReport(expected));
}

function assertProbeText(output, expected) {
  const lineStart = findProbeSegvTeardownLine(output);
  let normalized;
  if (lineStart !== -1) {
    // Log to facilitate debugging if this normalization is occurring.
    console.log('Normalizing trailing SIGSEGV in text probe output');
    const expectedLineStart = expected.lastIndexOf('\n');
    const terminalLine = expectedLineStart === -1 ? expected : expected.slice(expectedLineStart + 1);
    normalized = lineStart === 0 ? terminalLine : `${output.slice(0, lineStart - 1)}\n${terminalLine}`;
  } else {
    normalized = output;
  }
  assert.strictEqual(normalized, expected);
}

function assertProbeCliError(inspectArgs, expectedStderr, { cwd } = {}) {
  spawnSyncAndExit(process.execPath, ['inspect', ...inspectArgs], { cwd }, {
    signal: null,
    status: 9,
    stderr: expectedStderr,
    trim: true,
  });
}

module.exports = {
  assertProbeJson,
  assertProbeCliError,
  assertProbeText,
  runAttachedProbe,
  runProbe,
  startTarget,
};
