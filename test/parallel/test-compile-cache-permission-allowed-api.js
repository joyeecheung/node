'use strict';

// This tests module.enableCompileCache() works with permission allow lists.

require('../common');
const { spawnSyncAndAssert } = require('../common/child_process');
const tmpdir = require('../common/tmpdir');
const fixtures = require('../common/fixtures');
const fs = require('fs');
const { constants: { compileCacheStatus } } = require('module');

function testAllowed(readDir, writeDir, envDir) {
  console.log(readDir, writeDir, envDir);  // Logging for debugging.

  tmpdir.refresh();
  const dummyDir = tmpdir.resolve('dummy');
  fs.mkdirSync(dummyDir);
  const script = tmpdir.resolve(dummyDir, 'empty.js');
  const trampoline = tmpdir.resolve(dummyDir, 'enable-compile-cache.js');
  fs.copyFileSync(fixtures.path('enable-compile-cache.js'), trampoline);
  fs.copyFileSync(fixtures.path('empty.js'), script);
  // If the directory doesn't exist, permission will just be disallowed.
  fs.mkdirSync(tmpdir.resolve(envDir));

  spawnSyncAndAssert(
    process.execPath,
    [
      '--experimental-permission',
      `--allow-fs-read=${dummyDir}`,
      `--allow-fs-read=${readDir}`,
      `--allow-fs-write=${writeDir}`,
      trampoline,
    ],
    {
      env: {
        ...process.env,
        NODE_DEBUG_NATIVE: 'COMPILE_CACHE',
        NODE_TEST_CACHE_DIR: `${envDir}`,
        NODE_TEST_CACHE_ENTRY: script,
      },
      cwd: tmpdir.path
    },
    {
      stdout: JSON.stringify({
        status: compileCacheStatus.kEnabled,
        directory: tmpdir.resolve(envDir),
      }),
      stderr: /writing cache for .*empty\.js.*success/,
      trim: true,
    });

  spawnSyncAndAssert(
    process.execPath,
    [
      '--experimental-permission',
      `--allow-fs-read=${dummyDir}`,
      `--allow-fs-read=${readDir}`,
      `--allow-fs-write=${writeDir}`,
      trampoline,
    ],
    {
      env: {
        ...process.env,
        NODE_DEBUG_NATIVE: 'COMPILE_CACHE',
        NODE_TEST_CACHE_DIR: `${envDir}`,
        NODE_TEST_CACHE_ENTRY: script,
      },
      cwd: tmpdir.path,
    },
    {
      stdout: JSON.stringify({
        status: compileCacheStatus.kEnabled,
        directory: tmpdir.resolve(envDir),
      }),
      stderr: /cache for .*empty\.js was accepted/
    });
}

{
  testAllowed(tmpdir.resolve('.compile_cache'), tmpdir.resolve('.compile_cache'), '.compile_cache');
  testAllowed(tmpdir.resolve('.compile_cache'), tmpdir.resolve('.compile_cache'), tmpdir.resolve('.compile_cache'));
  testAllowed('*', '*', '.compile_cache');
  testAllowed('*', tmpdir.resolve('.compile_cache'), '.compile_cache');
  testAllowed(tmpdir.resolve('.compile_cache'), '*', '.compile_cache');
}
