'use strict';

const {
  ArrayIsArray,
  PromisePrototypeThen,
  SafeSet,
  SafeWeakMap,
  ObjectFreeze,
} = primordials;

const {
  privateSymbols: {
    host_defined_option_symbol,
  },
} = internalBinding('util');
const {
  ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING,
  ERR_INVALID_ARG_VALUE,
} = require('internal/errors').codes;
const { getOptionValue } = require('internal/options');
const { pathToFileURL } = require('internal/url');
const { kEmptyObject } = require('internal/util');
const {
  setImportModuleDynamicallyCallback,
  setInitializeImportMetaObjectCallback,
} = internalBinding('module_wrap');
const assert = require('internal/assert');

let defaultConditions;
function getDefaultConditions() {
  assert(defaultConditions !== undefined);
  return defaultConditions;
}

let defaultConditionsSet;
function getDefaultConditionsSet() {
  assert(defaultConditionsSet !== undefined);
  return defaultConditionsSet;
}

// This function is called during pre-execution, before any user code is run.
function initializeDefaultConditions() {
  const userConditions = getOptionValue('--conditions');
  const noAddons = getOptionValue('--no-addons');
  const addonConditions = noAddons ? [] : ['node-addons'];

  defaultConditions = ObjectFreeze([
    'node',
    'import',
    ...addonConditions,
    ...userConditions,
  ]);
  defaultConditionsSet = new SafeSet(defaultConditions);
}

/**
 * @param {string[]} [conditions]
 * @returns {Set<string>}
 */
function getConditionsSet(conditions) {
  if (conditions !== undefined && conditions !== getDefaultConditions()) {
    if (!ArrayIsArray(conditions)) {
      throw new ERR_INVALID_ARG_VALUE('conditions', conditions,
                                      'expected an array');
    }
    return new SafeSet(conditions);
  }
  return getDefaultConditionsSet();
}

/**
 * @callback ImportModuleDynamicallyCallback
 * @param {string} specifier
 * @param {ModuleWrap|ContextifyScript|Function|vm.Module} callbackReferrer
 * @param {object} assertions
 * @returns { Promise<void> }
 */

/**
 * @callback InitializeImportMetaCallback
 * @param {object} meta
 * @param {ModuleWrap|ContextifyScript|Function|vm.Module} callbackReferrer
 */

/**
 * @typedef {{
 *   callbackReferrer: ModuleWrap|ContextifyScript|Function|vm.Module
 *   initializeImportMeta? : InitializeImportMetaCallback,
 *   importModuleDynamically? : ImportModuleDynamicallyCallback
 * }} ModuleRegistry
 */

/**
 * @type {WeakMap<symbol, ModuleRegistry>}
 */
const moduleRegistries = new SafeWeakMap();

/**
 * V8 would make sure that as long as import() can still be initiated from
 * the referrer, the symbol referenced by |host_defined_option_symbol| should
 * be alive, which in term would keep the settings object alive through the
 * WeakMap, and in turn that keeps the referrer object alive, which would be
 * passed into the callbacks.
 * The reference goes like this:
 * [v8::internal::Script] (via host defined options) ----1--> [idSymbol]
 * [callbackReferrer] (via host_defined_option_symbol) ------2------^  |
 *                                 ^----------3---- (via WeakMap)------
 * 1+3 makes sure that as long as import() can still be initiated, the
 * referrer wrap is still around and can be passed into the callbacks.
 * 2 is only there so that we can get the id symbol to configure the
 * weak map.
 * @param {ModuleWrap|ContextifyScript|Function} referrer The referrer to
 *   get the id symbol from. This is different from callbackReferrer which
 *   could be set by the caller.
 * @param {ModuleRegistry} registry
 */
function registerModule(referrer, registry) {
  const idSymbol = referrer[host_defined_option_symbol];
  // To prevent it from being GC'ed. If
  registry.callbackReferrer ??= referrer;
  moduleRegistries.set(idSymbol, registry);
}

// The native callback
function initializeImportMetaObject(symbol, meta) {
  if (moduleRegistries.has(symbol)) {
    const { initializeImportMeta, callbackReferrer } = moduleRegistries.get(symbol);
    if (initializeImportMeta !== undefined) {
      meta = initializeImportMeta(meta, callbackReferrer);
    }
  }
}

// The native callback
async function importModuleDynamicallyCallback(symbol, specifier, assertions) {
  if (moduleRegistries.has(symbol)) {
    const { importModuleDynamically, callbackReferrer } = moduleRegistries.get(symbol);
    if (importModuleDynamically !== undefined) {
      return importModuleDynamically(specifier, callbackReferrer, assertions);
    }
  }
  throw new ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING();
}

// This is configured during pre-execution. Specifically it's set to true for
// the loader worker in internal/main/worker_thread.js.
let _isLoaderWorker = false;
function initializeESM(isLoaderWorker = false) {
  _isLoaderWorker = isLoaderWorker;
  initializeDefaultConditions();
  // Setup per-isolate callbacks that locate data or callbacks that we keep
  // track of for different ESM modules.
  setInitializeImportMetaObjectCallback(initializeImportMetaObject);
  setImportModuleDynamicallyCallback(importModuleDynamicallyCallback);
}

function isLoaderWorker() {
  return _isLoaderWorker;
}

async function initializeHooks() {
  const customLoaderURLs = getOptionValue('--experimental-loader');

  let cwd;
  try {
    // `process.cwd()` can fail if the parent directory is deleted while the process runs.
    cwd = process.cwd() + '/';
  } catch {
    cwd = '/';
  }


  const { Hooks } = require('internal/modules/esm/hooks');
  const hooks = new Hooks();

  const { DefaultModuleLoader } = require('internal/modules/esm/loader');
  class ModuleLoader extends DefaultModuleLoader {
    loaderType = 'internal';
    async #getModuleJob(specifier, parentURL, importAssertions) {
      const resolveResult = await hooks.resolve(specifier, parentURL, importAssertions);
      return this.getJobFromResolveResult(resolveResult, parentURL, importAssertions);
    }
    getModuleJob(specifier, parentURL, importAssertions) {
      const jobPromise = this.#getModuleJob(specifier, parentURL, importAssertions);
      return {
        run() {
          return PromisePrototypeThen(jobPromise, (job) => job.run());
        },
        get modulePromise() {
          return PromisePrototypeThen(jobPromise, (job) => job.modulePromise);
        },
        get linked() {
          return PromisePrototypeThen(jobPromise, (job) => job.linked);
        },
      };
    }
    load(url, context) { return hooks.load(url, context); }
  }
  const privateModuleLoader = new ModuleLoader();
  const parentURL = pathToFileURL(cwd).href;

  // TODO(jlenon7): reuse the `Hooks.register()` method for registering loaders.
  for (let i = 0; i < customLoaderURLs.length; i++) {
    const customLoaderURL = customLoaderURLs[i];

    // Importation must be handled by internal loader to avoid polluting user-land
    const keyedExports = await privateModuleLoader.import(
      customLoaderURL,
      parentURL,
      kEmptyObject,
    );

    hooks.addCustomLoader(customLoaderURL, keyedExports);
  }

  const preloadScripts = hooks.initializeGlobalPreload();

  return { __proto__: null, hooks, preloadScripts };
}

module.exports = {
  registerModule,
  initializeESM,
  initializeHooks,
  getDefaultConditions,
  getConditionsSet,
  loaderWorkerId: 'internal/modules/esm/worker',
  isLoaderWorker,
};
