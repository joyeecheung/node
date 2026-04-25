import assert from 'node:assert';
import path from 'node:path';
import v8 from 'node:v8';

assert(v8.startupSnapshot.isBuildingSnapshot());
assert.strictEqual(typeof path.sep, 'string');

v8.startupSnapshot.setDeserializeMainFunction((state) => {
  assert.strictEqual(state.sep, path.sep);
  console.log('ESM snapshot executed successfully');
}, { sep: path.sep });