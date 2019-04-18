'use strict';

// To avoid the overhead in the console abstraction, write to the
// stdout/stderr directly.

function formatAndWrite(fd, obj, ignoreErrors, colors = false) {
  const { formatWithOptions } = require('internal/util/inspect');
  const str = formatWithOptions({ colors }, obj) + '\n';
  const { writeSync } = require('fs');
  if (ignoreErrors) {
    try { writeSync(fd, str); } catch { }
  } else {
    writeSync(fd, str);
  }
}

function consoleLog(str) {
  const { log } = require('internal/console/global');
  log(str);
}

function print(fd, obj, ignoreErrors = true) {
  const { guessHandleType } = internalBinding('util');
  switch (guessHandleType(fd)) {
    case 'TTY':
      const colors = require('internal/tty').getColorDepth() > 2;
      formatAndWrite(fd, obj, ignoreErrors, colors);
      break;
    case 'FILE':
      formatAndWrite(fd, obj, ignoreErrors);
      break;
    case 'PIPE':
    case 'TCP':
      // Needs to handle IPC.
      if (process.channel && process.channel.fd === fd) {
        consoleLog(obj);
      } else {
        formatAndWrite(fd, obj, ignoreErrors);
      }
      break;
    default:
      consoleLog(obj);
  }
}

const kStdout = 1;
const kStderr = 2;

module.exports = {
  print,
  kStderr,
  kStdout
};
