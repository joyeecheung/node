'use strict';

// A target for probe attach tests that runs tick() continuously, so a breakpoint in it pauses the
// target as soon as it is bound.
let count = 0;

function tick() {
  count = count + 1;
  setImmediate(tick);
}

tick();
console.log('ready');
