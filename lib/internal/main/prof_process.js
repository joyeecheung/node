'use strict';

// TODO(joyeecheung): put the context locals in import.meta, and
// support dynamic import.
const {
  ArrayPrototypePush,
  ArrayPrototypePushApply,
  ArrayPrototypeSlice,
  StringPrototypeSlice,
} = primordials;

const {
  prepareMainThreadExecution,
  markBootstrapComplete,
} = require('internal/process/pre_execution');

const { importSync } = internalBinding('builtins');

prepareMainThreadExecution();
markBootstrapComplete();

const { globals, openFile } = require('internal/v8_prof_polyfill');
Object.assign(globalThis, globals);
openFile(process.argv[process.argv.length - 1]);

(async() => {
  const {
    promise,
    namespace,
  } = importSync('internal/deps/v8/tools/tickprocessor-driver');
  await promise;
})();
