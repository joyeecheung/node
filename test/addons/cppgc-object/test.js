'use strict';

// Flags: --expose-gc

const common = require('../../common');

// Verify that addons can create GarbageCollected objects and
// have them traced properly.

const assert = require('assert');
const {
  CppGCed, states, kDestructCount, kTraceCount
} = require(`./build/${common.buildType}/binding`);

let array = [];
const count = 100;
for (let i = 0; i < count; ++i) {
  array.push(new CppGCed());
}

gc();
setImmediate(() => {
  // GC should have invoked Trace() on all the CppGCed objects.
  assert.strictEqual(states[kDestructCount], 0);
  assert.strictEqual(states[kTraceCount], count);

  // Replace the old CppGCed objects with new ones, after GC we should have
  // destructed all the old ones and called Trace() on the
  // new ones.
  for (let i = 0; i < count; ++i) {
    array[i] = new CppGCed();
  }
  gc();

  setImmediate(() => {
    assert.strictEqual(states[kDestructCount], count);
    assert.strictEqual(states[kTraceCount], count * 2);

    // Release all the CppGCed objects, after GC we should have destructed
    // all of them.
    array = null;
    gc();

    setImmediate(() => {
      assert.strictEqual(states[kDestructCount], count * 2);
      assert.strictEqual(states[kTraceCount], count * 2);
    });
  });

});
