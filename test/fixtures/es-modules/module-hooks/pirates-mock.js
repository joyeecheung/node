'use strict';
const { fileURLToPath } = require('url');
const { addHooks, removeHooks } = require('module');

function addHook(hook, options) {
  function load(url, context, nextLoad) {
    const { source: originalSource } = nextLoad(url, context);
    const index = url.lastIndexOf('.');
    const ext = url.slice(index);
    if (!options.exts.includes(ext)) {
      return { source: originalSource };
    }
    const filename = fileURLToPath(url);
    if (!options.matcher(filename)) {
      return { source: originalSource };
    }
    const source = hook(originalSource, filename);
    return { source }
  }

  const id = addHooks({ load });

  return function revert() {
    removeHooks(id);
  };
}

module.exports = { addHook };
