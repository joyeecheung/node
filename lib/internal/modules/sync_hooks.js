'use strict';

const {
  ArrayPrototypeFindIndex,
  ArrayPrototypePush,
  ArrayPrototypeSplice,
  ObjectFreeze,
  StringPrototypeStartsWith,
  Symbol,
} = primordials;
const {
  isAnyArrayBuffer,
  isArrayBufferView,
} = require('internal/util/types');

const { BuiltinModule } = require('internal/bootstrap/realm');
const {
  ERR_INVALID_RETURN_PROPERTY, ERR_INVALID_RETURN_PROPERTY_VALUE,
} = require('internal/errors').codes;
const { validateFunction } = require('internal/validators');
const { isAbsolute } = require('path');
const { pathToFileURL, fileURLToPath } = require('internal/url');
const assert = require('internal/assert');

let debug = require('internal/util/debuglog').debuglog('module_hooks', (fn) => {
  debug = fn;
});

/** @typedef {import('internal/modules/cjs/loader.js').Module} Module */

// Use arrays for better insertion and iteration performance.
const resolveHooks = [];
const loadHooks = [];
const hookId = Symbol('kModuleHooksIdKey');
let nextHookId = 0;

class ModuleHooks {
  constructor(resolve, load) {
    this[hookId] = Symbol(`module-hook-${nextHookId++}`);
    // Always initialize all hooks, if it's unspecified it'll be an owned undefined.
    this.resolve = resolve;
    this.load = load;

    if (resolve) {
      ArrayPrototypePush(resolveHooks, this);
    }
    if (load) {
      ArrayPrototypePush(loadHooks, this);
    }

    ObjectFreeze(this);
  }
  // TODO(joyeecheung): we may want methods that allow disabling/enabling temporarily
  // which just sets the item in the array to undefined temporarily.
  // TODO(joyeecheung): this can be the [Symbol.dispose] implementation to pair with
  // `using` when the explicit resource management proposal is shipped by V8.
  deregister() {
    const id = this[hookId];
    let index = ArrayPrototypeFindIndex(resolveHooks, (hook) => hook[hookId] === id);
    if (index !== -1) {
      ArrayPrototypeSplice(resolveHooks, index, 1);
    }
    index = ArrayPrototypeFindIndex(loadHooks, (hook) => hook[hookId] === id);
    if (index !== -1) {
      ArrayPrototypeSplice(loadHooks, index, 1);
    }
  }
};

// TODO(joyeecheung): taken an optional description?
function registerHooks(hooks) {
  const { resolve, load } = hooks;
  if (resolve) {
    validateFunction(resolve, 'hooks.resolve');
  }
  if (load) {
    validateFunction(load, 'hooks.load');
  }
  return new ModuleHooks(resolve, load);
}

function convertCJSFilenameToURL(filename) {
  if (!filename) { return filename; }
  const builtinId = BuiltinModule.normalizeRequirableId(filename);
  if (builtinId) {
    return `node:${builtinId}`;
  }
  // Handle the case where filename is neither a path, nor a built-in id,
  // which is possible via monkey-patching.
  if (isAbsolute(filename)) {
    return pathToFileURL(filename).href;
  }
  return filename;
}

function convertURLToCJSFilename(url) {
  if (!url) { return url; }
  const builtinId = BuiltinModule.normalizeRequirableId(url);
  if (builtinId) {
    return builtinId;
  }
  if (StringPrototypeStartsWith(url, 'file://')) {
    return fileURLToPath(url);
  }
  return url;
}

function buildHooks(hooks, key, defaultStep, validate) {
  let lastRunIndex = hooks.length;
  function wrapHook(index, userHook, next) {
    return function wrappedHook(...args) {
      lastRunIndex = index;
      const hookResult = userHook(...args, next);
      if (lastRunIndex > 0 && lastRunIndex === index && !hookResult.shortCircuit) {
        throw new ERR_INVALID_RETURN_PROPERTY_VALUE('true', key, 'shortCircuit',
                                                    hookResult.shortCircuit);
      }
      return validate(hookResult);
    };
  }
  const chain = [wrapHook(0, defaultStep)];
  for (let i = 0; i < hooks.length; ++i) {
    const wrappedHook = wrapHook(i + 1, hooks[i][key], chain[i]);
    ArrayPrototypePush(chain, wrappedHook);
  }
  return chain[chain.length - 1];
}

/**
 * @typedef {object} ModuleResolveResult
 * @property {string} url Resolved URL of the module.
 * @property {string|undefined} format Format of the module.
 * @property {ImportAttributes|undefined} importAttributes Import attributes for the request.
 * @property {boolean|undefined} shortCircuit Whether the next hook has been skipped.
 */

/**
 * @param {ModuleLoadResult} result Result produced by resolve hooks
 * @returns {ModuleResolveResult}
 */
function validateResolve(result) {
  const { url, format, importAttributes } = result;
  if (typeof url !== 'string') {
    throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
      'a URL string',
      'resolve',
      'url',
      url,
    );
  }

  if (format && typeof format !== 'string') {
    throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
      'a string',
      'resolve',
      'format',
      format,
    );
  }

  if (importAttributes && typeof importAttributes !== 'object') {
    throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
      'an object',
      'resolve',
      'importAttributes',
      importAttributes,
    );
  }

  return {
    __proto__: null,
    url,
    format,
    importAttributes,
  };
}

/**
 * @typedef {object} ModuleLoadResult
 * @property {string|undefined} format Format of the loaded module.
 * @property {string|ArrayBuffer|TypedArray} source Source code of the module.
 * @property {boolean|undefined} shortCircuit Whether the next hook has been skipped.
 */

/**
 * @param {ModuleLoadResult} result Result produced by load hooks.
 * @returns {ModuleLoadResult}
 */
function validateLoad(result) {
  const { source, format } = result;
  if (typeof result.source !== 'string' &&
      !isAnyArrayBuffer(source) &&
      !isArrayBufferView(source)) {
    throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
      'a string, an ArrayBuffer, or a TypedArray',
      'load',
      'source',
      source,
    );
  }

  if (typeof format !== 'string' && format !== undefined) {
    throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
      'a string',
      'load',
      'format',
      format,
    );
  }

  return {
    __proto__: null,
    format,
    source,
  };
}

class ModuleResolveContext {
  constructor(parentURL, importAttributes, conditions) {
    this.parentURL = parentURL;
    this.importAttributes = importAttributes;
    this.conditions = conditions;
    // TODO(joyeecheung): a field to differentiate between require and import?
  }
};

class ModuleLoadContext {
  constructor(format, importAttributes, conditions) {
    this.format = format;
    this.importAttributes = importAttributes;
    this.conditions = conditions;
  }
};

/**
 * @param {string} url
 * @param {string|undefined} originalFormat
 * @param {ImportAttributes|undefined} importAttributes
 * @param {string[]} conditions
 * @param {(url: string, context: ModuleLoadContext) => ModuleLoadResult} defaultLoad
 * @returns {ModuleLoadResult}
 */

let decoder;
function loadWithHooks(url, originalFormat, importAttributes, conditions, defaultLoad) {
  debug('loadWithHooks', url, originalFormat);
  const context = new ModuleLoadContext(originalFormat, importAttributes, conditions);
  if (loadHooks.length === 0) {
    return defaultLoad(url, context);
  }

  const runner = buildHooks(loadHooks, 'load', defaultLoad, validateLoad);

  const result = runner(url, context);
  const source = { result };
  if (!isAnyArrayBuffer(source) &&
      !isArrayBufferView(source)) {
    return result;
  }
  decoder ??= new (require('internal/encoding').TextDecoder)();
  result.source = decoder.decode(source);
  return result;
}

/**
 * @param {string} specifier
 * @param {string|undefined} parentURL
 * @param {ImportAttributes|undefined} importAttributes
 * @param {string[]} conditions
 * @param {(specifier: string, context: ModuleResolveContext) => ModuleResolveResult} defaultResolve
 * @returns {ModuleResolveResult}
 */
function resolveWithHooks(specifier, parentURL, importAttributes, conditions, defaultResolve) {
  debug('resolveWithHooks', specifier, parentURL, importAttributes);
  const context = new ModuleResolveContext(parentURL, importAttributes, conditions);
  if (resolveHooks.length === 0) {
    return defaultResolve(specifier, context);
  }

  const runner = buildHooks(resolveHooks, 'resolve', defaultResolve, validateResolve);

  return runner(specifier, context);
}

module.exports = {
  convertCJSFilenameToURL,
  convertURLToCJSFilename,
  loadHooks,
  loadWithHooks,
  registerHooks,
  resolveHooks,
  resolveWithHooks,
};
