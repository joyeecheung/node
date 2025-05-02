const url = process.env.REQUEST_URL;

let request;
if (url.startsWith('https')) {
  request = require('https').get;
} else {
  request = require('http').get;
}

const req = request(url, (res) => {
  // Log the status code
  console.log(`Status Code: ${res.statusCode}`);
  console.log('Headers:', res.headers);
  res.pipe(process.stdout);
});

req.on('error', (e) => {
  console.error('Error', e);
});

req.end();
