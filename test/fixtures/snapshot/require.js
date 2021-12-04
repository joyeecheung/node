'use strict';

const fs = require('fs');
const modules = JSON.parse(fs.readFileSync('./modules.json', 'utf-8'));
const errored = [];
const loaded = [];

for (const id of modules) {
  try {
    require(id);
    loaded.push(id);
  } catch(e) {
    errored.push(id);
  }
}

fs.writeFileSync('./loaded.json', JSON.stringify(loaded), 'utf-8');
fs.writeFileSync('./errored.json', JSON.stringify(errored), 'utf-8');
