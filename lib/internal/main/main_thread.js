'use strict';

const {
  prepareUserCodeExecution
} = require('internal/bootstrap/pre_execution');

const {
  getOptionValue
} = require('internal/options');

const {
  checkScriptSyntax,
  evalScript
} = require('internal/process/execution');

prepareUserCodeExecution();

// If the first argument is a file name, run it as a main script
if (process.argv[1] && process.argv[1] !== '-') {
  // Expand process.argv[1] into a full path.
  const path = require('path');
  process.argv[1] = path.resolve(process.argv[1]);

  const CJSModule = require('internal/modules/cjs/loader');

  // If user passed `-c` or `--check` arguments to Node, check its syntax
  // instead of actually running the file.
  if (getOptionValue('--check')) {
    const fs = require('fs');
    // Read the source.
    const filename = CJSModule._resolveFilename(process.argv[1]);
    const source = fs.readFileSync(filename, 'utf-8');
    checkScriptSyntax(source, filename);
    process.exit(0);
  }

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
  return;
}

// Stdin is not a TTY, we will read it and execute it.

process.stdin.setEncoding('utf8');

let code = '';
process.stdin.on('data', (d) => {
  code += d;
});

process.stdin.on('end', () => {
  if (process._syntax_check_only != null) {
    checkScriptSyntax(code, '[stdin]');
  } else {
    process._eval = code;
    evalScript('[stdin]', process._eval, process._breakFirstLine);
  }
});
