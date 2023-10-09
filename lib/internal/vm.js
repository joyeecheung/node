'use strict';

const {
  Symbol,
  ReflectApply,
  ObjectHasOwn,
} = primordials;

const {
  compileFunction,
  isContext: _isContext,
  ContextifyScript,
} = internalBinding('contextify');
const {
  runInContext,
} = ContextifyScript.prototype;
const {
  default_host_defined_options,
  vm_dynamic_import_missing_flag,
} = internalBinding('symbols');
const {
  validateFunction,
  validateObject,
  kValidateObjectAllowArray,
} = require('internal/validators');
const {
  getOptionValue,
} = require('internal/options');

function isContext(object) {
  validateObject(object, 'object', kValidateObjectAllowArray);

  return _isContext(object);
}

function getInternalImportCallback(parentURL) {
  const cascadedLoader = require('internal/process/esm_loader').esmLoader;
  function importModuleDynamically(specifier, _, importAssertions) {
    return cascadedLoader.import(specifier, parentURL, importAssertions);
  }
  // To bypass the check for --experimental-vm-flag.
  importModuleDynamically[vm_dynamic_import_missing_flag] = true;
  return importModuleDynamically;
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
  // cache can still be hit, use a constant sentinel symbol here. Internal
  // usage of the importModuleDynamically should store
  // vm_dynamic_import_missing_flag in the callback to bypass this check.
  if (!ObjectHasOwn(importModuleDynamically, vm_dynamic_import_missing_flag) &&
      !getOptionValue('--experimental-vm-flag')) {
    return vm_dynamic_import_missing_flag;
  }

  return Symbol(filename);
}

function internalCompileFunction(
  code, filename, lineOffset, columnOffset,
  cachedData, produceCachedData, parsingContext, contextExtensions,
  params, hostDefinedOptionId, importModuleDynamically) {
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

class InternalScript extends ContextifyScript {
  constructor(code,
              filename,
              lineOffset,
              columnOffset,
              cachedData,
              produceCachedData,
              parsingContext,
              hostDefinedOptionId,
              importModuleDynamically) {
    // Calling `ReThrow()` on a native TryCatch does not generate a new
    // abort-on-uncaught-exception check. A dummy try/catch in JS land
    // protects against that.
    try { // eslint-disable-line no-useless-catch
      super(code,
            filename,
            lineOffset,
            columnOffset,
            cachedData,
            produceCachedData,
            parsingContext,
            hostDefinedOptionId);
    } catch (e) {
      throw e; /* node-do-not-add-exception-line */
    }

    if (importModuleDynamically !== undefined) {
      const { importModuleDynamicallyWrap } = require('internal/vm/module');
      const { registerModule } = require('internal/modules/esm/utils');
      registerModule(this, {
        __proto__: null,
        importModuleDynamically:
          importModuleDynamicallyWrap(importModuleDynamically),
      });
    }
  }
}

function runScriptInThisContext(script, displayErrors, breakOnFirstLine) {
  ReflectApply(
    runInContext,
    script,
    undefined,           // sandbox - use current context
    -1,                  // timeout
    displayErrors,       // displayErrors
    false,               // breakOnSigint
    breakOnFirstLine,    // breakOnFirstLine
  );
}

module.exports = {
  InternalScript,
  internalCompileFunction,
  isContext,
  getHostDefinedOptionId,
  getInternalImportCallback,
  runScriptInThisContext,
};
