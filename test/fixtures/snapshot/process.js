'use strict';

const obj = {
  env: process.env,
  argv: process.argv,
  execPath: process.execPath,
  execArgv: process.execArgv,
  pid: process.pid
};
console.log(JSON.stringify(obj, null, 2));
