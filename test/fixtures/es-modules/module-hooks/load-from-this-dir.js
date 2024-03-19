'use strict';

module.exports = {
  localRequire(id) {
    return require(id);
  },
  localImport(id) {
    return import(id);
  }
};
