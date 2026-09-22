'use strict';

// A target with two hot timers for probe attach bind-race tests. Both
// functions tick every 5 ms, so a breakpoint on one can pause the target
// while the probe session is still binding the other.
let a = 0;
let b = 0;

function tickA() {
  a = a + 1;
}

function tickB() {
  b = b + 1;
}

setInterval(tickA, 5);
setInterval(tickB, 5);

console.log('ready');
