'use strict';

const { addHook } = require('./add-hook');

const matcherArgs = [];
function matcher(filename) {
  matcherArgs.push(filename);
  return true;
}

function hook(code, filename) {
  hookArgs.push({ code, filename });
  return code.replace('$key', 'hello');
}

const hookArgs = [];
function register() {
  return addHook(hook, { exts: ['.js'], matcher });
}

module.exports = {
  localRequire(id) {
    return require(id);
  },
  localImport(id) {
    return import(id);
  },
  register,
  matcherArgs,
  hookArgs,
};
