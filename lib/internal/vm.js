'use strict';

const {
  ArrayPrototypeForEach,
  Symbol,
} = primordials;

const {
  compileFunction,
  isContext: _isContext,
} = internalBinding('contextify');
const {
  default_host_defined_options,
  vm_dynamic_import_missing_flag,
} = internalBinding('symbols');
const {
  validateArray,
  validateBoolean,
  validateBuffer,
  validateFunction,
  validateObject,
  validateString,
  validateStringArray,
  validateUint32,
  kValidateObjectAllowArray,
  kValidateObjectAllowNullable,
} = require('internal/validators');
const {
  ERR_INVALID_ARG_TYPE,
} = require('internal/errors').codes;
const {
  getOptionValue,
} = require('internal/options');

function isContext(object) {
  validateObject(object, 'object', kValidateObjectAllowArray);

  return _isContext(object);
}

function getHostDefinedOptionId(importModuleDynamically, filename) {
  if (importModuleDynamically !== undefined) {
    // Check that it's either undefined or a function before we pass
    // it into the native constructor.
    validateFunction(importModuleDynamically,
                     'options.importModuleDynamically');
  }
  if (importModuleDynamically === undefined) {
    // We need a default host defined options that are the same for all
    // scripts not needing custom module callbacks so that the isolate
    // compilation cache can be hit.
    return default_host_defined_options;
  }
  // We should've thrown here immediately when we introduced
  // --experimental-vm-flag and importModuleDynamically, but since
  // users are already using this callback to throw a similar error,
  // we also defer the error to the time when an actual import() is called
  // to avoid breaking them. To ensure that the isolate compilation
  // cache can still be hit, use a constant sentinel symbol here.
  if (!getOptionValue('--experimental-vm-flag')) {
    return vm_dynamic_import_missing_flag;
  }

  return Symbol(filename);

}

function internalCompileFunction(code, params, options) {
  validateString(code, 'code');
  if (params !== undefined) {
    validateStringArray(params, 'params');
  }
  const {
    filename = '',
    columnOffset = 0,
    lineOffset = 0,
    cachedData = undefined,
    produceCachedData = false,
    parsingContext = undefined,
    contextExtensions = [],
    importModuleDynamically,
  } = options;

  validateString(filename, 'options.filename');
  validateUint32(columnOffset, 'options.columnOffset');
  validateUint32(lineOffset, 'options.lineOffset');
  if (cachedData !== undefined)
    validateBuffer(cachedData, 'options.cachedData');
  validateBoolean(produceCachedData, 'options.produceCachedData');
  if (parsingContext !== undefined) {
    if (
      typeof parsingContext !== 'object' ||
      parsingContext === null ||
      !isContext(parsingContext)
    ) {
      throw new ERR_INVALID_ARG_TYPE(
        'options.parsingContext',
        'Context',
        parsingContext,
      );
    }
  }
  validateArray(contextExtensions, 'options.contextExtensions');
  ArrayPrototypeForEach(contextExtensions, (extension, i) => {
    const name = `options.contextExtensions[${i}]`;
    validateObject(extension, name, kValidateObjectAllowNullable);
  });

  const hostDefinedOptionId =
      getHostDefinedOptionId(importModuleDynamically, filename);
  const result = compileFunction(
    code,
    filename,
    lineOffset,
    columnOffset,
    cachedData,
    produceCachedData,
    parsingContext,
    contextExtensions,
    params,
    hostDefinedOptionId,
  );

  if (produceCachedData) {
    result.function.cachedDataProduced = result.cachedDataProduced;
  }

  if (result.cachedData) {
    result.function.cachedData = result.cachedData;
  }

  if (typeof result.cachedDataRejected === 'boolean') {
    result.function.cachedDataRejected = result.cachedDataRejected;
  }

  if (importModuleDynamically !== undefined) {
    validateFunction(importModuleDynamically,
                     'options.importModuleDynamically');
    const { importModuleDynamicallyWrap } = require('internal/vm/module');
    const wrapped = importModuleDynamicallyWrap(importModuleDynamically);
    const func = result.function;
    const { registerModule } = require('internal/modules/esm/utils');
    registerModule(func, {
      __proto__: null,
      importModuleDynamically: wrapped,
    });
  }

  return result;
}

module.exports = {
  internalCompileFunction,
  isContext,
  getHostDefinedOptionId,
};
