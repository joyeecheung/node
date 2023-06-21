'use strict';

// Flags: --experimental-vm-modules --max-heap-size=20
// This tests that vm.SyntheticModule does not leak.
// See https://github.com/nodejs/node/issues/44211

require('../common');
const vm = require('vm');

let count = 0;
async function createModule() {
  const m = new vm.SyntheticModule(['bar'], () => {
    m.setExport('bar', new Date().toISOString().repeat(1e6));
  });
  await m.link(() => {});
  await m.evaluate();
  count++;
  if (count < 30000) {
    setImmediate(createModule);
  }
  return m;
}

createModule();
