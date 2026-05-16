'use strict';

const fs = require('fs');
const inspector = require('inspector');

fs.writeSync(2, 'probe-inspector-close-marker\n');

function closeInspector() {
  inspector.close();
}

function runProbes(closeInspector) {
  let firstProbeLine = 1;
  let secondProbeLine = 2;
}

// Export to keep `closeInspector` referenced (probe expressions invoke it).
module.exports = { closeInspector };

runProbes(closeInspector);
setInterval(() => {}, 1000);
