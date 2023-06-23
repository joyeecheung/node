'use strict';

// Flags: --max-heap-size=20

require('../common');
const vm = require('vm');
const v8 = require('v8');
let count = 0;

function main() {
  new vm.Script(`"${new Date().toISOString().repeat(1e3)}"`, {
    async importModuleDynamically() {},
  });
  if (count++ < 100) {
    setImmediate(main);
  } else {
    console.log(v8.writeHeapSnapshot());
  }
}
main();
