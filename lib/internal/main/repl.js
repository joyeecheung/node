'use strict';

const {
  prepareUserCodeExecution
} = require('internal/bootstrap/pre_execution');

const {
  evalScript
} = require('internal/process/execution');

prepareUserCodeExecution();

// Create the REPL if `-i` or `--interactive` is passed, or if
// stdin is a TTY.
// Note that the name `forceRepl` is merely an alias of `interactive`
// in code.
// process._forceRepl || require('tty').isatty(0))
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
