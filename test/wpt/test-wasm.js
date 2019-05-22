'use strict';

require('../common');
const { WPTRunner } = require('../common/wpt');

const runner = new WPTRunner('wasm');

// Copy global descriptors from the global object
runner.copyGlobalsFromObject(global, [
  'WebAssembly'
]);

runner.runJsTests();
