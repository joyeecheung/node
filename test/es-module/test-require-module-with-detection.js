// Flags: --experimental-require-module --experimental-detect-module
'use strict';

const common = require('../common');
const assert = require('assert');
const { isModuleNamespaceObject } = require('util/types');

{
  const mod = require('../fixtures/es-modules/loose.js');
  common.expectNamespace(mod, { default: 'module' });
}

{
  const mod = require('../fixtures/es-modules/package-without-type/noext-esm');
  common.expectNamespace(mod, { default: 'module' });
}
