const url = process.env.REQUEST_URL;

let request;
if (url.startsWith('https')) {
  request = require('https').get;
} else {
  request = require('http').get;
}

const req = request(url, (res) => {
  res.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
});

req.on('error', (e) => {
  console.error(e.message);
});

req.end();
