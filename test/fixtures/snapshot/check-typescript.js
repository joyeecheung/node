'use strict';

let ts;
if (process.env.NODE_TEST_USE_SNAPSHOT === 'true') {
  console.error('NODE_TEST_USE_SNAPSHOT true');
  ts = globalThis.ts;
} else {
  console.error('NODE_TEST_USE_SNAPSHOT false');
  ts = require('./typescript');
}

const source = `
class VirtualPoint {
  x: number;
  y: number;
 
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
 
const newVPoint = new VirtualPoint(13, 56);`;

let result = ts.transpileModule(
  source,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS
    }
  });

console.log(result.outputText);
