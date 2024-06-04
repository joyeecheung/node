'use strict';

const { addHook } = require('./pirates-mock');

const matcherArgs = [];
function matcher(filename) {
  matcherArgs.push(filename);
  return true;
}

function hook(code, filename) {
  hookArgs.push({ code, filename });
  return code.replace('world', 'earth');
}
const hookArgs = [];
const revert = addHook(hook, { exts: ['.js'], matcher });

module.exports = {
  load(id) {
    return require(id);
  },
  revert,
  matcherArgs,
  hookArgs,
};
