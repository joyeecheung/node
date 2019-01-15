'use strict';

const {
  prepareUserCodeExecution
} = require('internal/bootstrap/pre_execution');

const {
  evalScript,
  readStdin
} = require('internal/process/execution');

prepareUserCodeExecution();

// If the first argument is a file name, run it as a main script
if (process.argv[1] && process.argv[1] !== '-') {
  // Expand process.argv[1] into a full path.
  const path = require('path');
  process.argv[1] = path.resolve(process.argv[1]);

  const CJSModule = require('internal/modules/cjs/loader');

  // Note: this actually tries to run the module as a ESM first if
  // --experimental-modules is on.
  // TODO(joyeecheung): can we move that logic to here? Note that this
  // is an undocumented method available via `require('module').runMain`
  CJSModule.runMain();
  return;
}

// TODO(joyeecheung): move the following to repl.js
// Create the REPL if `-i` or `--interactive` is passed, or if
// stdin is a TTY.
// Note that the name `forceRepl` is merely an alias of `interactive`
// in code.
if (process._forceRepl || require('tty').isatty(0)) {
  const cliRepl = require('internal/repl');
  cliRepl.createInternalRepl(process.env, (err, repl) => {
    if (err) {
      throw err;
    }
    repl.on('exit', () => {
      if (repl._flushing) {
        repl.pause();
        return repl.once('flushHistory', () => {
          process.exit();
        });
      }
      process.exit();
    });
  });

  // User passed '-e' or '--eval' along with `-i` or `--interactive`
  if (process._eval != null) {
    evalScript('[eval]', process._eval, process._breakFirstLine);
  }
} else {
  // Stdin is not a TTY, we will read it and execute it.
  readStdin((code) => {
    process._eval = code;
    evalScript('[stdin]', process._eval, process._breakFirstLine);
  });
}
