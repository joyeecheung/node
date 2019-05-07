'use strict';

// This tests that --cpu-prof, --cpu-prof-dir and --cpu-prof-name works.

const common = require('../common');
const fixtures = require('../common/fixtures');
common.skipIfInspectorDisabled();

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const tmpdir = require('../common/tmpdir');

function getCpuProfiles(dir) {
  const list = fs.readdirSync(dir);
  return list
    .filter((file) => file.endsWith('.cpuprofile'))
    .map((file) => path.join(dir, file));
}

function getFrames(file, func) {
  const data = fs.readFileSync(file, 'utf8');
  const profile = JSON.parse(data);
  const frames = profile.nodes.filter((i) => {
    const frame = i.callFrame;
    return frame.functionName === func;
  });
  return { frames, nodes: profile.nodes };
}

function verifyFrames(output, file, func) {
  const { frames, nodes } = getFrames(file, func);
  if (frames.length === 0) {
    // Show native debug output and the profile for debugging.
    console.log(output.stderr.toString());
    console.log(nodes);
  }
  assert.notDeepStrictEqual(frames, []);
}


// We need to set --cpu-interval to a smaller value to make sure we can
// find our workload in the samples. Make sure that
// TEST_DURATION > kCpuProfInterval.
const kCpuProfInterval = 100;  // us
const kFactor = 1000;
const TEST_DURATION = kCpuProfInterval * kFactor * 1000;  // ns
const TEST_REPEAT = 10;

const env = {
  ...process.env,
  NODE_DEBUG_NATIVE: 'INSPECTOR_PROFILER',
  TEST_DURATION,
  TEST_REPEAT
};

const workload = fixtures.path('workload', 'run-duration');

// Test --cpu-prof without --cpu-prof-interval.
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env: {
      ...env,
      // default CPU profile sampling rate is 1000
      TEST_DURATION: 1000 * kFactor * 1000
    }
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  const profiles = getCpuProfiles(tmpdir.path);
  assert.strictEqual(profiles.length, 1);
}

// Outputs CPU profile when event run-duration is drained.
// TODO(joyeecheung): share the fixutres with v8 coverage tests
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  const profiles = getCpuProfiles(tmpdir.path);
  assert.strictEqual(profiles.length, 1);
  verifyFrames(output, profiles[0], 'runDuration');
}

// Outputs CPU profile when process.exit(55) exits process.
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    path.join(workload, 'run-duration-exit.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 55) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 55);
  const profiles = getCpuProfiles(tmpdir.path);
  assert.strictEqual(profiles.length, 1);
  verifyFrames(output, profiles[0], 'runDuration');
}

// Outputs CPU profile when process.kill(process.pid, "SIGINT"); exits process.
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    path.join(workload, 'run-duration-sigint.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (!common.isWindows) {
    if (output.signal !== 'SIGINT') {
      console.log(output.stderr.toString());
    }
    assert.strictEqual(output.signal, 'SIGINT');
  }
  const profiles = getCpuProfiles(tmpdir.path);
  assert.strictEqual(profiles.length, 1);
  verifyFrames(output, profiles[0], 'runDuration');
}

// Outputs CPU profile from worker when execArgv is set.
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    path.join(workload, 'run-duration-worker-argv.js'),
  ], {
    cwd: tmpdir.path,
    env: {
      ...process.env,
      CPU_PROF_INTERVAL: kCpuProfInterval
    }
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  const profiles = getCpuProfiles(tmpdir.path);
  assert.strictEqual(profiles.length, 1);
  verifyFrames(output, profiles[0], 'runDuration');
}

// --cpu-prof-name without --cpu-prof
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof-name',
    'test.cpuprofile',
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  const stderr = output.stderr.toString().trim();
  if (output.status !== 9) {
    console.log(stderr);
  }
  assert.strictEqual(output.status, 9);
  assert.strictEqual(
    stderr,
    `${process.execPath}: --cpu-prof-name must be used with --cpu-prof`);
}

// --cpu-prof-dir without --cpu-prof
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof-dir',
    'prof',
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  const stderr = output.stderr.toString().trim();
  if (output.status !== 9) {
    console.log(stderr);
  }
  assert.strictEqual(output.status, 9);
  assert.strictEqual(
    stderr,
    `${process.execPath}: --cpu-prof-dir must be used with --cpu-prof`);
}

// --cpu-prof-interval without --cpu-prof
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof-interval',
    100,
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  const stderr = output.stderr.toString().trim();
  if (output.status !== 9) {
    console.log(stderr);
  }
  assert.strictEqual(output.status, 9);
  assert.strictEqual(
    stderr,
    `${process.execPath}: --cpu-prof-interval must be used with --cpu-prof`);
}

// --cpu-prof-name
{
  tmpdir.refresh();
  const file = path.join(tmpdir.path, 'test.cpuprofile');
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    '--cpu-prof-name',
    'test.cpuprofile',
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  const profiles = getCpuProfiles(tmpdir.path);
  assert.deepStrictEqual(profiles, [file]);
  verifyFrames(output, file, 'runDuration');
}

// relative --cpu-prof-dir
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    '--cpu-prof-dir',
    'prof',
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  const dir = path.join(tmpdir.path, 'prof');
  assert(fs.existsSync(dir));
  const profiles = getCpuProfiles(dir);
  assert.strictEqual(profiles.length, 1);
  verifyFrames(output, profiles[0], 'runDuration');
}

// absolute --cpu-prof-dir
{
  tmpdir.refresh();
  const dir = path.join(tmpdir.path, 'prof');
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    '--cpu-prof-dir',
    dir,
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  assert(fs.existsSync(dir));
  const profiles = getCpuProfiles(dir);
  assert.strictEqual(profiles.length, 1);
  verifyFrames(output, profiles[0], 'runDuration');
}

// --cpu-prof-dir and --cpu-prof-name
{
  tmpdir.refresh();
  const dir = path.join(tmpdir.path, 'prof');
  const file = path.join(dir, 'test.cpuprofile');
  const output = spawnSync(process.execPath, [
    '--cpu-prof',
    '--cpu-prof-interval',
    kCpuProfInterval,
    '--cpu-prof-name',
    'test.cpuprofile',
    '--cpu-prof-dir',
    dir,
    path.join(workload, 'run-duration.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  assert(fs.existsSync(dir));
  const profiles = getCpuProfiles(dir);
  assert.deepStrictEqual(profiles, [file]);
  verifyFrames(output, file, 'runDuration');
}

// --cpu-prof-dir with worker
{
  tmpdir.refresh();
  const output = spawnSync(process.execPath, [
    '--cpu-prof-interval',
    kCpuProfInterval,
    '--cpu-prof-dir',
    'prof',
    '--cpu-prof',
    path.join(workload, 'run-duration-worker.js'),
  ], {
    cwd: tmpdir.path,
    env
  });
  if (output.status !== 0) {
    console.log(output.stderr.toString());
  }
  assert.strictEqual(output.status, 0);
  const dir = path.join(tmpdir.path, 'prof');
  assert(fs.existsSync(dir));
  const profiles = getCpuProfiles(dir);
  assert.strictEqual(profiles.length, 2);
  const profile1 = getFrames(profiles[0], 'runDuration');
  const profile2 = getFrames(profiles[1], 'runDuration');
  if (profile1.frames.length === 0 && profile2.frames.length === 0) {
    // Show native debug output and the profile for debugging.
    console.log(output.stderr.toString());
    console.log('CPU path: ', profiles[0]);
    console.log(profile1.nodes);
    console.log('CPU path: ', profiles[1]);
    console.log(profile2.nodes);
  }
  assert(profile1.frames.length > 0 || profile2.frames.length > 0);
}
