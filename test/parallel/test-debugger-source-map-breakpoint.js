'use strict';
const common = require('../common');

common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const startCLI = require('../common/debugger');

const assert = require('assert');

// A breakpoint set on an original (source-mapped) line resolves to the
// generated code, pauses there, and is reported back in original coordinates.
const script = fixtures.path('source-map/tabs-source-url.js');

(async () => {
  // Coffee line 9 (`square = (x) -> x * x`) has a direct mapping.
  {
    const cli = startCLI([script]);
    try {
      await cli.waitForInitialBreak();
      await cli.waitForPrompt();

      await cli.command('sb(9)');
      // The breakpoint snippet is listed in original coordinates.
      assert.match(cli.output, /> 9 square = \(x\) -> x \* x/);

      // The breakpoint is listed in original coordinates, and marked in the
      // original source listing.
      await cli.command('breakpoints');
      assert.match(cli.output, /#0 .*tabs-source-url\.coffee:9/);
      await cli.command('list(10)');
      assert.match(cli.output, /\* 9 square = \(x\) -> x \* x/);

      // Continuing pauses at the original line.
      await cli.stepCommand('c');
      assert.match(cli.output, /break in .*tabs-source-url\.coffee:9/);
    } finally {
      await cli.quit();
    }
  }

  // A line with no direct mapping (the `# Functions:` comment on line 8)
  // resolves forward to the next mapped line.
  {
    const cli = startCLI([script]);
    try {
      await cli.waitForInitialBreak();
      await cli.waitForPrompt();

      await cli.command('sb(8)');
      await cli.stepCommand('c');
      assert.match(cli.output, /break in .*tabs-source-url\.coffee:9/);
    } finally {
      await cli.quit();
    }
  }
})().then(common.mustCall());
