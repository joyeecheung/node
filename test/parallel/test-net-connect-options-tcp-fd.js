'use strict';
const common = require('../common');
const assert = require('assert');
const net = require('net');
const TCP = process.binding('tcp_wrap').TCP;

if (common.isWindows) {
  common.skip('Does not support wrapping sockets with fd on Windows');
  return;
}

function testClients(getSocketOpt, getConnectOpt, getConnectCb) {
  const cloneOptions = (index) =>
    Object.assign({}, getSocketOpt(index), getConnectOpt(index));
  return [
    net.connect(cloneOptions(0), getConnectCb(0)),
    net.connect(cloneOptions(1))
      .on('connect', getConnectCb(1)),
    net.createConnection(cloneOptions(2), getConnectCb(2)),
    net.createConnection(cloneOptions(3))
      .on('connect', getConnectCb(3)),
    new net.Socket(getSocketOpt(4)).connect(getConnectOpt(4), getConnectCb(4)),
    new net.Socket(getSocketOpt(5)).connect(getConnectOpt(5))
      .on('connect', getConnectCb(5))
  ];
}

const CLIENT_VARIANTS = 6;  // Same length as array above
const forAllClients = (cb) => common.mustCall(cb, CLIENT_VARIANTS);

// Test TCP fd is wrapped correctly
{
  let counter = 0;
  const handleMap = new Map();
  const server = net.createServer()
  .on('connection', forAllClients(function serverOnConnection(socket) {
    let clientFd;
    socket.on('data', common.mustCall(function(data) {
      clientFd = data.toString();
      console.error(`[TCP]Received data from fd ${clientFd}`);
      socket.end();
    }));
    socket.on('end', common.mustCall(function() {
      counter++;
      console.error(`[TCP]Received end from fd ${clientFd}, total ${counter}`);
      if (counter === CLIENT_VARIANTS) {
        setTimeout(() => {
          console.error(`[TCP]Server closed by fd ${clientFd}`);
          server.close();
        }, 10);
      }
    }, 1));
  }))
  .on('error', function(err) {
    console.error(err);
    assert.fail(null, null, '[TCP server]' + err);
  })
  .listen(0, 'localhost', common.mustCall(function serverOnListen() {
    const port = server.address().port;
    const getSocketOpt = (index) => {
      const handle = new TCP();
      const address = server.address().address;
      let err = 0;
      if (net.isIPv6(address)) {
        err = handle.bind6(address, 0);
      } else {
        err = handle.bind(address, 0);
      }

      assert(err >= 0, '' + err);
      assert.notStrictEqual(handle.fd, -1);
      handleMap.set(index, handle);

      console.error(`[TCP]Bound handle with fd ${handle.fd}`);
      return { fd: handle.fd, readable: true, writable: true };
    };

    const getConnectOpt = () => ({
      host: 'localhost',
      port: port,
    });

    const getConnectCb = (index) => common.mustCall(function clientOnConnect() {
      const client = this;
      // Test if it's wrapping an existing fd
      assert(handleMap.has(index));
      const oldHandle = handleMap.get(index);
      assert.strictEqual(oldHandle.fd, this._handle.fd);
      client.write(oldHandle.fd + '');
      console.error(`[TCP]Sending data through fd ${oldHandle.fd}`);

      client.on('error', function(err) {
        console.error(err);
        assert.fail(null, null, '[TCP client]' + err);
      });
    });

    testClients(getSocketOpt, getConnectOpt, getConnectCb);
  }));
}
