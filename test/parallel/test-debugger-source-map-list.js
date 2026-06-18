'use strict';
const common = require('../common');

common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const startCLI = require('../common/debugger');

const assert = require('assert');

// Listing a transpiled script lists the original source via its source map,
// rather than the generated code that is actually executed.
const cli = startCLI([fixtures.path('source-map/tabs-source-url.js')]);

(async () => {
  await cli.waitForInitialBreak();
  await cli.waitForPrompt();

  // The break header points at the original CoffeeScript file.
  assert.match(cli.output, /in .*tabs-source-url\.coffee:1/);

  await cli.command('list(2)');
  // Original source lines are shown, not the compiled JS.
  assert.match(cli.output, /> 1 # Assignment:/);
  assert.match(cli.output, /2 number {3}= 42/);
  assert.doesNotMatch(cli.output, /function\(\)/);
})()
.finally(() => cli.quit())
.then(common.mustCall());
