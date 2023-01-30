'use strict';

const http = require('http');
const {
  setDeserializeMainFunction
} = require('v8').startupSnapshot;
const dc = require('diagnostics_channel');

const echoServer = http.createServer(function(req, res) {
  let result = '';

  req.setEncoding('utf8');
  req.on('data', function(chunk) {
    result += chunk;
  });

  req.on('end', function() {
    res.writeHead(200);
    res.end(result);
  });
});

const kNumChars = 256;
const buffer = new Uint8Array(kNumChars);
for (let i = 0; i < kNumChars; ++i) {
  buffer[i] = i;
}

let recv = '';

echoServer.on('listening', function() {
  const port = this.address().port;
  console.log(`server port`, port);

  const c = http.request({
    port,
    host: '127.0.0.1',
    path: '/test'
  });

  c.on('data', function(chunk) {
    recv += chunk.toString('latin1');

    if (recv.length === buffer.length) {
      c.end();
    }
  });

  c.on('connect', function() {
    c.write(buffer);
  });

  c.on('close', function() {
    console.log(`recv.length: ${recv.length}`);
    echoServer.close();
  });
});

dc.subscribe('http.server.request.start', (({ request }) => {
  console.log(`http.server.request.start:`, request.path);
}));

dc.subscribe('http.server.response.finish', (({ request }) => {
  console.log(`http.server.response.finish`);
}));

dc.subscribe('http.client.request.start', (({ request }) => {
  console.log(`http.client.request.start:`, request.path);
}));

dc.subscribe('http.client.response.finish', (({ request }) => {
  console.log(`http.client.response.finish`);
}));

setDeserializeMainFunction(() => {
  echoServer.listen(0);
});
