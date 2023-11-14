'use strict';

const { isSea, getAsset: getAssetInternal } = internalBinding('sea');
const { TextDecoder } = require('internal/encoding');
const { validateString } = require('internal/validators');
const {
  ERR_NOT_IN_SEA,
  ERR_SEA_ASSET_NOT_FOUND,
} = require('internal/errors').codes;
const { Blob } = require('internal/blob');

function getRawAsset(key) {
  validateString(key, 'key');

  if (!isSea()) {
    throw new ERR_NOT_IN_SEA();
  }

  const asset = getAssetInternal(key);
  if (asset === undefined) {
    throw new ERR_SEA_ASSET_NOT_FOUND(key);
  }
  return asset;
}

function getAsset(key, encoding) {
  if (encoding !== undefined) {
    validateString(encoding, 'encoding');
  }
  const asset = getRawAsset(key);
  if (encoding === undefined) {
    return asset.slice();
  }
  const decoder = new TextDecoder(encoding);
  return decoder.decode(asset);
}

function getAssetAsBlob(key, options) {
  const asset = getRawAsset(key);
  return new Blob([asset], options);
}

module.exports = {
  isSea,
  getAsset,
  getAssetAsBlob,
};
