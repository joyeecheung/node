const url = process.env.REQUEST_URL;

let lib;
if (url.startsWith('https')) {
  lib = require('https');
} else {
  lib = require('http');
}

const request = lib.get;

let timeout;
if (process.env.REQUEST_TIMEOUT) {
  timeout = parseInt(process.env.REQUEST_TIMEOUT, 10);
}
let agent;
if (process.env.AGENT_TIMEOUT) {
  agent = new lib.Agent({
    useEnvProxy: true,
    timeout: parseInt(process.env.AGENT_TIMEOUT, 10)
  });
}
const req = request(url, {
  timeout,
  agent,
}, (res) => {
  // Log the status code
  console.log(`Status Code: ${res.statusCode}`);
  console.log('Headers:', res.headers);
  res.pipe(process.stdout);
});

req.on('error', (e) => {
  console.error('Request Error', e);
});

req.on('timeout', () => {
  console.error('Request timed out');
  req.destroy();
});

req.end();
