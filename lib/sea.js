'use strict';

const { isSea, getAsset: getAssetInternal } = internalBinding('sea');
const { TextDecoder } = require('internal/encoding');
const { validateString } = require('internal/validators');
const { ERR_SEA_ASSET_NOT_FOUND } = require('internal/errors').codes;

function getAsset(key, encoding) {
  validateString(key, 'key');
  validateString(encoding, 'encoding');
  const asset = getAssetInternal(key);
  if (asset === undefined) {
    throw new ERR_SEA_ASSET_NOT_FOUND(key);
  }

  if (encoding === 'copy') {
    return asset.slice();
  }
  const decoder = new TextDecoder(encoding);
  return decoder.decode(asset);
}

module.exports = {
  isSea,
  getAsset,
};
