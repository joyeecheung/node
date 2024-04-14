'use strict';

const { spawnSync } = require("child_process");
const sleepTime = new Number(process.argv[2] || "0.1");
const optimize = process.argv[3] === 'optimize';

const characters = 'abcdef';
function key() {
  const index = Math.floor(Math.random() * characters.length);
  return characters[index];
}

function functionOne(obj) {
  obj[key()] = 'I am here so that the function is not inlined a';
  obj[key()] = 'I am here so that the function is not inlined b';
  obj[key()] = 'I am here so that the function is not inlined c';
  obj[key()] = 'I am here so that the function is not inlined d';
  obj[key()] = 'I am here so that the function is not inlined e';
  obj[key()] = 'I am here so that the function is not inlined f';

  functionTwo(obj);
}

function functionTwo(obj) {
  obj[key()] = 'I am here so that the function is not inlined a';
  obj[key()] = 'I am here so that the function is not inlined b';
  obj[key()] = 'I am here so that the function is not inlined c';
  obj[key()] = 'I am here so that the function is not inlined d';
  obj[key()] = 'I am here so that the function is not inlined e';
  obj[key()] = 'I am here so that the function is not inlined f';

  spawnSync('sleep', [`${sleepTime}`]);
}

if (optimize) {
  %PrepareFunctionForOptimization(functionOne);
  %PrepareFunctionForOptimization(functionTwo);
  functionOne();
  functionOne();
  %OptimizeFunctionOnNextCall(functionOne);
  %OptimizeFunctionOnNextCall(functionTwo);
  functionOne();
  functionOne();
  functionOne();
} else {
  %NeverOptimizeFunction(functionOne);
  %NeverOptimizeFunction(functionTwo);
  functionOne();
  functionOne();
  functionOne();
  functionOne();
  functionOne();
}
