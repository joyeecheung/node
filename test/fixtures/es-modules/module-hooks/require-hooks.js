'use strict';

const { registerHooks } = require('module');
const { fileURLToPath } = require('url');
const { getStats } = require('./get-stats');
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
    this.hook = registerHooks({ exports });
  }
  unhook() {
    this.hook.deregister();
  }
}

module.exports = {
  Hook
};
