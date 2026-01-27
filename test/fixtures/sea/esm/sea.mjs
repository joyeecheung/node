import assert from 'node:assert';
import { createRequire } from 'node:module';

// TODO(joyeecheung): support import.meta and import()
const assert2 = createRequire(process.execPath)('node:assert');
assert.strictEqual(assert2.strict, assert.strict);
console.log('ESM SEA executed successfully');
