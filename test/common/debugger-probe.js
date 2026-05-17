'use strict';

const assert = require('assert');

// Work around a pre-existing inspector issue: if the debuggee exits too quickly
// the inspector can segfault while tearing down. For now normalize the segfault
// back to the expected terminal event (e.g. "completed" or "miss")
// until the upstream bug is fixed.
// See https://github.com/nodejs/node/issues/62765
// https://github.com/nodejs/node/issues/58245
const probeTargetExitSignal = 'SIGSEGV';

function isProbeSegvTeardown(result) {
  if (result?.event !== 'error') { return false; }
  const error = result.error;
  if (error?.signal !== probeTargetExitSignal) { return false; }
  return error.code === 'probe_target_exit' || error.code === 'probe_failure';
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

function assertProbeJson(output, expected) {
  const normalized = JSON.parse(output);
  const lastResult = normalized.results?.[normalized.results.length - 1];

  if (isProbeSegvTeardown(lastResult)) {
    // Log to facilitate debugging if this normalization is occurring.
    console.log('Normalizing trailing SIGSEGV in JSON probe output');
    normalized.results[normalized.results.length - 1] = expected.results.at(-1);
  }

  assert.deepStrictEqual(normalizeProbeReport(normalized), normalizeProbeReport(expected));
}

function assertProbeText(output, expected) {
  const targetExitPrefix = `Target exited with signal ${probeTargetExitSignal}`;
  // Inspector-failure text doesn't carry the signal string, so look for the
  // leading phrase of the external-cause variant.
  const inspectorFailureLine = 'Inspector connection lost';
  let idx = output.indexOf(targetExitPrefix);
  if (idx === -1) { idx = output.indexOf(inspectorFailureLine); }

  let normalized;
  if (idx !== -1) {
    // Log to facilitate debugging if this normalization is occurring.
    console.log('Normalizing trailing SIGSEGV in text probe output');
    const lineStart = output.lastIndexOf('\n', idx);
    normalized = (lineStart === -1 ? '' : output.slice(0, lineStart)) + '\nCompleted';
  } else {
    normalized = output;
  }
  assert.strictEqual(normalized, expected);
}

module.exports = {
  assertProbeJson,
  assertProbeText,
};
