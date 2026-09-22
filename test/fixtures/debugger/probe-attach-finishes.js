'use strict';

// A target for probe attach tests that runs tick() once and exits when its stdin is closed.
let count = 0;

function tick() {
  count = count + 1;
}

process.stdin.on('end', tick);
process.stdin.resume();
console.log('ready');
