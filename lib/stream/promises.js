'use strict';

module.exports = {
  finished: require('internal/streams/end-of-stream').finished,
  pipeline: require('internal/streams/pipeline').pipeline[customPromisify],
};
