'use strict';

// This leaks because of the strong persistent v8::Module references
// from ModuleWrap. We need replace that with a GC-aware ModuleWrap ->
// v8::Module reference to fix this.
// See: https://github.com/nodejs/node/issues/33439

require('../common');
const assert = require('assert');

// We use a child process here because known_issues doesn't work with
// hard crashes. We could just test this block with the flags when
// it's fixed.
if (process.argv[2] === 'child') {
  const vm = require('vm');
  let count = 0;
  async function createModule() {
    const m = new vm.SourceTextModule('export default "hello".repeat(1e5)');
    await m.link(() => {});
    await m.evaluate();
    count++;
    if (count < 30000) {
      setImmediate(createModule);
    }
    return m;
  }
  createModule();
} else {
  const { spawnSync } = require('child_process');
  const child = spawnSync(`${process.execPath}`, [
    '--experimental-vm-modules',
    '--max-heap-size=20',
    __filename,
    'child']
  );
  assert.strictEqual(child.status, 0);
}
