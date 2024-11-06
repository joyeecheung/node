// This tests that a mini TypeScript loader works with resolve and
// load hooks.
import '../common/index.mjs';
import assert from 'node:assert';

await import('../fixtures/module-hooks/register-typescript-hooks.js');
const { UserAccount } = await import('../fixtures/module-hooks/user.ts');
assert.strictEqual((new UserAccount('foo', 1).name), 'foo');
