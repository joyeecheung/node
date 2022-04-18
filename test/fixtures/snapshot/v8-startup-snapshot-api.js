'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  isBuildingSnapshot,
  addDeserializeCallback,
  setDeserializeMainFunction
} = require('v8').startupSnapshot;

let deserializedKey;
const storage = {};

function checkFileInSnapshot(storage) {
  assert(!isBuildingSnapshot());
  const fixture = process.env.NODE_TEST_FIXTURE;
  const readFile = fs.readFileSync(fixture);
  console.log(`Read ${fixture} in deserialize main, length = ${readFile.byteLength}`);
  assert.deepStrictEqual(storage[deserializedKey], readFile);
}

if (isBuildingSnapshot()) {
  const fixture = path.join(__filename);

  const file = fs.readFileSync(fixture);
  console.log(`Read ${fixture} in snapshot main, length = ${file.byteLength}`);
  storage[fixture] = file;

  addDeserializeCallback((key) => {
    console.log('running deserialize callback');
    deserializedKey = key;
  }, fixture);

  setDeserializeMainFunction(
    checkFileInSnapshot,
    storage
  );
}