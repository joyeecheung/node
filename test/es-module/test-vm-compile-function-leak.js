'use strict';

// Flags: --max-old-space-size=16 --trace-gc

require('../common');
const vm = require('vm');
let count = 0;

function main() {
  vm.compileFunction(`"${Math.random().toString().repeat(512)}"`, [], {
    async importModuleDynamically() {},
  });
  if (count++ < 2048) {
    setTimeout(main, 1);
  }
}
main();
