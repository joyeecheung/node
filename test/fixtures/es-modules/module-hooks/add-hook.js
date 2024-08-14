'use strict';
const { fileURLToPath } = require('url');
const { registerHooks, deregisterHooks } = require('module');

// This is a simplified version of the pirates package API to
// check that a similar API can be built on top of the public
// hooks.
function addHook(hook, options) {
  function load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    const index = url.lastIndexOf('.');
    const ext = url.slice(index);
    if (!options.exts.includes(ext)) {
      return result;
    }
    const filename = fileURLToPath(url);
    if (!options.matcher(filename)) {
      return result;
    }
    return { source: hook(result.source.toString(), filename) }
  }

  const id = registerHooks({ load });

  return function revert() {
    deregisterHooks(id);
  };
}

module.exports = { addHook };
