'use strict';

// Flags: --max-old-space-size=16 --trace-gc

require('../common');
const vm = require('vm');
let count = 0;

function main() {
  new vm.Script(`"${Math.random().toString().repeat(512)}";`, {
    async importModuleDynamically() {},
  });
  if (count++ < 2 * 1024) {
    setTimeout(main, 1);
  }
}
main();
