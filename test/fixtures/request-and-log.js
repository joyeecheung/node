const http = require('http');

const req = http.request(process.env.REQUEST_URL, (res) => {
  let body = '';

  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log(body);
  });
});

req.on('error', (e) => {
  console.error(e.message);
});

req.end();
