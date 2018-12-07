// This file is compiled as if it's wrapped in a function with arguments
// passed by node::NewContext()
/* global globalProxy */

'use strict';

// https://github.com/nodejs/node/issues/14909
if (globalProxy.Intl) delete globalProxy.Intl.v8BreakIterator;

// https://github.com/nodejs/node/issues/21219
// Adds Atomics.notify and warns on first usage of Atomics.wake
// https://github.com/v8/v8/commit/c79206b363 adds Atomics.notify so
// now we alias Atomics.wake to notify so that we can remove it
// semver major without worrying about V8.

const AtomicsNotify = globalProxy.Atomics.notify;
const ReflectApply = globalProxy.Reflect.apply;

const warning = 'Atomics.wake will be removed in a future version, ' +
  'use Atomics.notify instead.';

let wakeWarned = false;
function wake(typedArray, index, count) {
  if (!wakeWarned) {
    wakeWarned = true;

    if (globalProxy.process !== undefined) {
      globalProxy.process.emitWarning(warning, 'Atomics');
    } else {
      globalProxy.console.error(`Atomics: ${warning}`);
    }
  }

  return ReflectApply(AtomicsNotify, this, arguments);
}

globalProxy.Object.defineProperties(globalProxy.Atomics, {
  wake: {
    value: wake,
    writable: true,
    enumerable: false,
    configurable: true,
  },
});
