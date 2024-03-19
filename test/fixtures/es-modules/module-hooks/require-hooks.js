'use strict';
const path = require('path');
const { addHooks, removeHooks } = require('module');
const { fileURLToPath } = require('url');

// Adapted from https://github.com/watson/module-details-from-path/blob/master/index.js
// used by require-in-the-middle to check the logic is still compatible with our new hooks.
function getStats(filepath) {
  const segments = filepath.split(path.sep);
  const index = segments.lastIndexOf('node_modules');
  if (index === -1) return {};
  if (!segments[index + 1]) return {};
  const scoped = segments[index + 1][0] === '@';
  const name = scoped ? segments[index + 1] + '/' + segments[index + 2] : segments[index + 1];
  const offset = scoped ? 3 : 2;
  return {
    name: name,
    basedir: segments.slice(0, index + offset).join(path.sep),
    path: segments.slice(index + offset).join(path.sep)
  }
}

class Hook {
  constructor(modules, callback) {
    function exports(url, context, nextExports) {
      let { exports: originalExports } = nextExports(url, context);
      const filepath = fileURLToPath(url);
      const stats = getStats(filepath);
      if (stats.name && modules.includes(stats.name)) {
        const newExports = callback(originalExports, stats.name, stats.basedir);
        return { exports: newExports }
      }
      return {
        exports: originalExports
      };
    }
    this.id = addHooks({ exports });
  }
  unhook() {
    removeHooks(this.id);
  }
}

module.exports = {
  Hook
};
