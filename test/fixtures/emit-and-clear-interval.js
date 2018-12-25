'use strict';
const interval = setInterval(() => {}, 1000);
const interval2 = setInterval(() => {}, 1000);

const EventEmitter = require('events');
const emitter = new EventEmitter();

emitter.on('test', function onTest() {
  clearInterval(interval);
  clearInterval(interval2);
});

global.run = function run() {
  emitter.emit('test');
};

console.log('Ready to verify');
