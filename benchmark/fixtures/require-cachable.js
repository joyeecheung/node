'use strict';

const { internalBinding } = require('internal/test/binding');
let canBeRequired;
if (process.moduleLoadList.includes('Internal Binding builtins')) {
  ({builtinCategories: { canBeRequired }} = internalBinding('builtins'));
} else {
  ({moduleCategories: { canBeRequired }} = internalBinding('native_module'));
}

let prefix = process.version < 'v17.' ? '' : 'node:';
for (const key of canBeRequired) {
  require(`${prefix}${key}`);
}
