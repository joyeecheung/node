'use strict';

// Flags: --max-heap-size=20

require('../common');
const vm = require('vm');
let count = 0;

function main() {
  vm.compileFunction(`"${new Date().toISOString().repeat(1e3)}"`, [], {
    async importModuleDynamically() {},
  });
  if (count++ < 100000) {
    setImmediate(main);
  }
}
main();
