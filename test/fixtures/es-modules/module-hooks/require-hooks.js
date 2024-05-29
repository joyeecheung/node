'use strict';
const path = require('path');
const { addHooks, removeHooks } = require('module');

class Hook {
  constructor(modules, callback) {
    const map = new Map;
    function resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (modules.include(specifier)) {
        let arr = map.get(resolved.filename);
        if (!arr) {
          arr = [];
          map.set(resolved.filename, arr);
        }
        arr.push({ name: specifier, callback });
      }
      return resolved;
    }
    function exports(context, nextExports) {
      let exported = nextExports(context);
      const arr = map.get(context.filename);
      // This should be the nearest node_modules or the nearest package.json path?
      const basedir = path.dirname(context.filename);
      if (arr) {
        for (const { name, callback } of arr) {
          exported = callback(exported, name, basedir);
        }
      }
      return {
        exports: exported
      };
    }
    this.id = addHooks({ resolve, exports });
  }
  unhook() {
    removeHooks(this.id);
  }
}

module.exports = {
  Hook
};
