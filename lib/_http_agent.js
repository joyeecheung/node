// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const {
  NumberParseInt,
  ObjectKeys,
  ObjectSetPrototypeOf,
  ObjectValues,
  Symbol,
  decodeURIComponent,
} = primordials;

const net = require('net');
const EventEmitter = require('events');
let debug = require('internal/util/debuglog').debuglog('http', (fn) => {
  debug = fn;
});
const { AsyncResource } = require('async_hooks');
const { async_id_symbol } = require('internal/async_hooks').symbols;
const {
  getLazy,
  kEmptyObject,
  once,
} = require('internal/util');
const {
  validateNumber,
  validateOneOf,
  validateString,
} = require('internal/validators');
const { URL } = require('internal/url');
const assert = require('internal/assert');
const kOnKeylog = Symbol('onkeylog');
const kRequestOptions = Symbol('requestOptions');
const kRequestAsyncResource = Symbol('requestAsyncResource');
const { ERR_PROXY_ERROR } = require('internal/errors').codes;
// TODO(jazelly): make this configurable
const HTTP_AGENT_KEEP_ALIVE_TIMEOUT_BUFFER = 1000;
// New Agent code.

// The largest departure from the previous implementation is that
// an Agent instance holds connections for a variable number of host:ports.
// Surprisingly, this is still API compatible as far as third parties are
// concerned. The only code that really notices the difference is the
// request object.

// Another departure is that all code related to HTTP parsing is in
// ClientRequest.onSocket(). The Agent is now *strictly*
// concerned with managing a connection pool.

class ReusedHandle {
  constructor(type, handle) {
    this.type = type;
    this.handle = handle;
  }
}

function parseNoProxy(noProxy) {
  return noProxy.split(',').map(entry => entry.trim().toLowerCase());
}

function isIPv4InCIDR(ip, cidr) {
  const [network, prefixLength] = cidr.split('/');
  if (!network || !prefixLength) return false;
  
  const ipInt = ipToInt(ip);
  const networkInt = ipToInt(network);
  const mask = (0xFFFFFFFF << (32 - parseInt(prefixLength, 10))) >>> 0;
  
  return (ipInt & mask) === (networkInt & mask);
}

function ipToInt(ip) {
  return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

function shouldBypassProxy(hostname, port, noProxyList) {
  if (!noProxyList || noProxyList.length === 0) return false;
  
  const host = hostname.toLowerCase();
  const hostWithPort = port ? `${host}:${port}` : host;
  
  for (const entry of noProxyList) {
    if (entry === '*') return true;
    if (entry === host || entry === hostWithPort) return true;
    
    // Handle domain wildcards like .example.com
    if (entry.startsWith('.') && host.endsWith(entry)) return true;
    
    // Handle wildcards like *.example.com
    if (entry.startsWith('*.') && host.endsWith(entry.substring(1))) return true;
    
    // Handle CIDR notation for IPv4 addresses
    if (entry.includes('/') && net.isIPv4(host)) {
      if (isIPv4InCIDR(host, entry)) return true;
    }
    
    // Handle IP ranges (simple format like 192.168.1.0-192.168.1.255)
    if (entry.includes('-') && net.isIPv4(host)) {
      const [startIP, endIP] = entry.split('-');
      if (startIP && endIP) {
        const hostInt = ipToInt(host);
        const startInt = ipToInt(startIP.trim());
        const endInt = ipToInt(endIP.trim());
        if (hostInt >= startInt && hostInt <= endInt) return true;
      }
    }
  }
  
  return false;
}

// TODO(joyeecheung): this might need to be a symbol property.
Agent.prototype.shouldUseProxy = function shouldUseProxy(hostname, port) {
  if (!this.proxyConfig) {
    return false;
  }
  if (!this.proxyConfig.bypassList) {
    return true;
  }
  return !shouldBypassProxy(hostname, port, this.proxyConfig.bypassList);
}

function freeSocketErrorListener(err) {
  const socket = this;
  debug('SOCKET ERROR on FREE socket:', err.message, err.stack);
  socket.destroy();
  socket.emit('agentRemove');
}

function Agent(options) {
  if (!(this instanceof Agent))
    return new Agent(options);

  EventEmitter.call(this);

  this.options = { __proto__: null, ...options };

  this.defaultPort = options.defaultPort || 80;
  this.protocol = options.protocol || 'http:';

  if (this.options.noDelay === undefined)
    this.options.noDelay = true;

  // Don't confuse net and make it think that we're connecting to a pipe
  this.options.path = null;
  this.requests = { __proto__: null };
  this.sockets = { __proto__: null };
  this.freeSockets = { __proto__: null };
  this.keepAliveMsecs = this.options.keepAliveMsecs || 1000;
  this.keepAlive = this.options.keepAlive || false;
  this.maxSockets = this.options.maxSockets || Agent.defaultMaxSockets;
  this.maxFreeSockets = this.options.maxFreeSockets || 256;
  this.scheduling = this.options.scheduling || 'lifo';
  this.maxTotalSockets = this.options.maxTotalSockets;
  this.totalSocketCount = 0;

  if (process.env.NODE_USE_ENV_PROXY && (this.protocol === 'https:' || this.protocol === 'http:')) {
    const proxyUrl = (this.protocol === 'https:') ?
      (process.env.HTTPS_PROXY || process.env.https_proxy) : (process.env.HTTP_PROXY || process.env.http_proxy);
    if (proxyUrl) {
      const { host, hostname, port, protocol, username, password } = new URL(proxyUrl);
      // TODO(joyeecheung): this might need to be a symbol property.
      this.proxyConfig = {
        href: proxyUrl,
        // Trim off the brackets from IPv6 addresses.
        host,
        hostname: (hostname).replace(/^\[|\]$/g, ''),
        port: port ? NumberParseInt(port, 10) : (protocol === 'https:' ? 443 : 80),
        protocol,
        headers: {
          'proxy-connection': this.keepAlive ? 'keep-alive' : 'close',
          '__proto__': null,
        },
      };
      if (username || password) {
        const auth = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
        this.proxyConfig.headers['proxy-authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
      }
      // Parse NO_PROXY environment variable
      const noProxy = process.env.NO_PROXY || process.env.no_proxy;
      if (noProxy) {
        this.proxyConfig.bypassList = parseNoProxy(noProxy);
      }
      debug('new agent with proxy config', this.proxyConfig);
    }
  }

  validateOneOf(this.scheduling, 'scheduling', ['fifo', 'lifo']);

  if (this.maxTotalSockets !== undefined) {
    validateNumber(this.maxTotalSockets, 'maxTotalSockets', 1);
  } else {
    this.maxTotalSockets = Infinity;
  }

  this.on('free', (socket, options) => {
    const name = this.getName(options);
    debug('agent.on(free)', name);

    // TODO(ronag): socket.destroy(err) might have been called
    // before coming here and have an 'error' scheduled. In the
    // case of socket.destroy() below this 'error' has no handler
    // and could cause unhandled exception.

    if (!socket.writable) {
      socket.destroy();
      return;
    }

    const requests = this.requests[name];
    if (requests?.length) {
      const req = requests.shift();
      const reqAsyncRes = req[kRequestAsyncResource];
      if (reqAsyncRes) {
        // Run request within the original async context.
        reqAsyncRes.runInAsyncScope(() => {
          asyncResetHandle(socket);
          setRequestSocket(this, req, socket);
        });
        req[kRequestAsyncResource] = null;
      } else {
        setRequestSocket(this, req, socket);
      }
      if (requests.length === 0) {
        delete this.requests[name];
      }
      return;
    }

    // If there are no pending requests, then put it in
    // the freeSockets pool, but only if we're allowed to do so.
    const req = socket._httpMessage;
    if (!req || !req.shouldKeepAlive || !this.keepAlive) {
      socket.destroy();
      return;
    }

    const freeSockets = this.freeSockets[name] || [];
    const freeLen = freeSockets.length;
    let count = freeLen;
    if (this.sockets[name])
      count += this.sockets[name].length;

    if (this.totalSocketCount > this.maxTotalSockets ||
        count > this.maxSockets ||
        freeLen >= this.maxFreeSockets ||
        !this.keepSocketAlive(socket)) {
      socket.destroy();
      return;
    }

    this.freeSockets[name] = freeSockets;
    socket[async_id_symbol] = -1;
    socket._httpMessage = null;
    this.removeSocket(socket, options);

    socket.once('error', freeSocketErrorListener);
    freeSockets.push(socket);
  });

  // Don't emit keylog events unless there is a listener for them.
  this.on('newListener', maybeEnableKeylog);
}
ObjectSetPrototypeOf(Agent.prototype, EventEmitter.prototype);
ObjectSetPrototypeOf(Agent, EventEmitter);

function maybeEnableKeylog(eventName) {
  if (eventName === 'keylog') {
    this.removeListener('newListener', maybeEnableKeylog);
    // Future sockets will listen on keylog at creation.
    const agent = this;
    this[kOnKeylog] = function onkeylog(keylog) {
      agent.emit('keylog', keylog, this);
    };
    // Existing sockets will start listening on keylog now.
    const sockets = ObjectValues(this.sockets);
    for (let i = 0; i < sockets.length; i++) {
      sockets[i].on('keylog', this[kOnKeylog]);
    }
  }
}

const lazyTLS = getLazy(() => require('tls'));

Agent.defaultMaxSockets = Infinity;

Agent.prototype.createConnection = function createConnection(options, ...args) {
  // Check if this specific request should bypass the proxy
  const host = options.hostname || options.host || 'localhost';
  const shouldUseProxy = this.shouldUseProxy(host, options.port);
  debug(`http createConnection should use proxy for ${host}:${options.port}:`, shouldUseProxy);
  if (!shouldUseProxy) {
    return net.createConnection(options, ...args);
  }

  const connectOptions = {
    // TODO(joyeecheung): parse options and extend it here.
    port: this.proxyConfig.port,
    host: this.proxyConfig.hostname,
  };
  if (this.proxyConfig.protocol === 'http:') {
    return net.connect(connectOptions, ...args);
  }
  return lazyTLS().connect(connectOptions, ...args);
};

// Get the key for a given set of request options
Agent.prototype.getName = function getName(options = kEmptyObject) {
  let name = options.host || 'localhost';

  name += ':';
  if (options.port)
    name += options.port;

  name += ':';
  if (options.localAddress)
    name += options.localAddress;

  // Pacify parallel/test-http-agent-getname by only appending
  // the ':' when options.family is set.
  if (options.family === 4 || options.family === 6)
    name += `:${options.family}`;

  if (options.socketPath)
    name += `:${options.socketPath}`;

  return name;
};

// There are two factors in play when proxying the request:
// 1. What the target protocol is, that is, whether users are sending it via
//    http.request or https.request, or whether they are sending
//    the request to a https:// URL or a http:// URL. HTTPS requests should be
//    proxied by the proxy specified using the HTTPS_PROXY environment variable.
//    HTTP requests should be proxied by the proxy specified using the HTTP_PROXY
//    environment variable.
// 2. What the proxy protocol is. This depends on the value of the environment variables,
//    for example.
//
// When proxying a HTTP request, the following needs to be done:
// 1. Rewrite the request path to be an absolute URL.
// 2. Add proxy-connection and proxy-authorization headers appropriately.
//
// When proxying a HTTPS request, the following needs to be done:
// 1. Send a CONNECT request to the proxy server.
// 2. Wait for 200 connection established.
// 3. Perform TLS handshake with the target server over the socket.
// 4. Tunnel the request using the established connection.
//
// When the proxy protocol is HTTP, the modified request can just be sent over
// the TCP socket as-is.
// When the proxy protocol is HTTPS, the modified request needs to be sent after
// TLS handshake with the proxy server.
//
// This function prepares the request according to whether the target protocol is
// HTTP or HTTPS.
// The handling of the proxy protocol is done in createConnection.
// TODO(joyeecheung): this might need to be a symbol property.
Agent.prototype.prepareRequestForProxy = function(req, reqOptions) {
  const { headers, href } = this.proxyConfig;
  if (reqOptions.protocol === 'http:' || (!reqOptions.protocol && this.protocol === 'http:')) {
    // The request is a HTTP request, only rewriting is needed.
    const keys = ObjectKeys(headers);
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      req.setHeader(key, headers[key]);
    }
    // According to RFC 7320, when using the http proxy, the request path must be absolute.
    const requestHost = req.getHeader('host') || 'localhost';
    const requestBase = `http://${requestHost}`;
    const requestURL = new URL(req.path, requestBase);
    if (reqOptions.port) {
      requestURL.port = reqOptions.port;
    }
    req.path = requestURL.href;
    req.rewrotePathForProxy = true;
    debug(`updated request for HTTP proxy ${href} with ${req.path} `, headers);
  } else if (reqOptions.protocol === 'https:' || (!reqOptions.protocol && this.protocol === 'https:')) {
    // The request is a HTTPS request, assemble the payload for establishing the tunnel.
    const requestHost = net.isIPv6(reqOptions.host) ? `[${reqOptions.host}]` : reqOptions.host;
    let payload = `CONNECT ${requestHost}:${reqOptions.port} HTTP/1.1\r\n`;
    const keys = ObjectKeys(headers);
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      payload += `${key}: ${headers[key]}\r\n`;
    }
    payload += `host: ${requestHost}:${reqOptions.port}`;

    // TODO(joyeecheung): this might need to be a symbol property.
    req.proxyTunnelPayload = `${payload}\r\n`;
    // Prepare the options used for the TLS handshake for the request over the tunnel.
    req.proxyTunnelOptions = {
      __proto__: null,
      servername: reqOptions.servername || (net.isIP(reqOptions.host) ? undefined : reqOptions.host),
      host: reqOptions.host,
      port: reqOptions.port,
      isTunneled: true,
    };
    debug(`updated request for HTTPS proxy ${href} with`);
    debug(req.proxyTunnelPayload);
  } else {
    assert.fail('Cannot proxy request');
  }
};

function afterTunnel(socket, req, afterSocket) {
  // Reuse the socket to perform the HTTPS handshake, then send the request.
  req.proxyTunnelOptions.socket = socket;
  req.once('socket', (socket) => {
    socket.resume();
  });
  const tunneldSocket = lazyTLS().connect(req.proxyTunnelOptions, (err) => {
    debug('proxy tls tunnel connected');
    afterSocket(err, tunneldSocket);
  });
  tunneldSocket.on('free', () => {
    socket.emit('free');
  });
}

function maybeTunnelRequest(agent, socket, options, req, afterSocket) {
  if (req.proxyTunnelPayload) {  // Proxied HTTPS request, establish the tunnel.
    // Tunnel is already established. Proxy the request over.
    if (socket.proxyTunnelPayload === req.proxyTunnelPayload) {
      afterTunnel(socket, req, afterSocket);
    } else {
      assert(socket.proxyTunnelPayload === undefined);

      function read() {
        let chunk;
        while ((chunk = socket.read()) !== null) {
          if (onProxyData(chunk) !== -1) {
            break;
          }
        }
        socket.on('readable', read);
      }

      function cleanup() {
        socket.removeListener('end', onProxyEnd);
        socket.removeListener('error', onProxyError);
        socket.removeListener('readable', read);
      }

      function onProxyError(err) {
        debug('onProxyError', err);
        cleanup();
        afterSocket(err, socket);
      }

      let buffer = '';
      function onProxyData(chunk) {
        const str = chunk.toString();
        debug('onProxyData', str);
        buffer += str;
        const headerEndIndex = buffer.indexOf('\r\n\r\n');
        if (headerEndIndex === -1) return headerEndIndex;
        const statusLine = buffer.substring(0, buffer.indexOf('\r\n'));
        const statusCode = statusLine.split(' ')[1];
        if (statusCode !== '200') {
          debug(`onProxyData receives ${statusCode}, cleaning up`);
          cleanup();
          const targetHost = req.proxyTunnelPayload.split('\r')[0].split(' ')[1];
          const message = `Failed to establish tunnel to ${targetHost} via ${agent.proxyConfig.href}: ${statusLine}`;
          const err = new ERR_PROXY_ERROR(message);
          afterSocket(err, socket);
          // Clean up the socket.
        } else {
          debug('onProxyData receives 200, establishing tunnel');
          cleanup();
          socket.proxyTunnelPayload = req.proxyTunnelPayload;
          afterTunnel(socket, req, afterSocket);
        }
        return headerEndIndex;
      }

      function onProxyEnd() {
        cleanup();
        const err = new ERR_PROXY_ERROR('Connection to establish proxy tunnel ended unexpectedly');
        afterSocket(err, socket);
      }

      socket.on('error', onProxyError);
      socket.on('end', onProxyEnd);
      socket.write(req.proxyTunnelPayload + '\r\n');

      read();
    }
  } else {  // HTTP request or there's no proxy configuration, just send the request.
    afterSocket(null, socket);
  }
}

Agent.prototype.addRequest = function addRequest(req, options, port/* legacy */,
                                                 localAddress/* legacy */) {
  // Legacy API: addRequest(req, host, port, localAddress)
  if (typeof options === 'string') {
    options = {
      __proto__: null,
      host: options,
      port,
      localAddress,
    };
  }

  options = { __proto__: null, ...options, ...this.options };
  if (options.socketPath)
    options.path = options.socketPath;

  normalizeServerName(options, req);

  const name = this.getName(options);
  this.sockets[name] ||= [];

  const freeSockets = this.freeSockets[name];
  let socket;
  if (freeSockets) {
    while (freeSockets.length && freeSockets[0].destroyed) {
      freeSockets.shift();
    }
    socket = this.scheduling === 'fifo' ?
      freeSockets.shift() :
      freeSockets.pop();
    if (!freeSockets.length)
      delete this.freeSockets[name];
  }

  const freeLen = freeSockets ? freeSockets.length : 0;
  const sockLen = freeLen + this.sockets[name].length;

  const host = options.hostname || options.host || 'localhost';
  const shouldUseProxy = this.shouldUseProxy(host, options.port);
  debug(`addRequest should use proxy for ${host}:${options.port}:`, shouldUseProxy);

  if (shouldUseProxy) {
    this.prepareRequestForProxy(req, options);
  }

  if (socket) {
    asyncResetHandle(socket);
    this.reuseSocket(socket, req);
    if (shouldUseProxy) {
      maybeTunnelRequest(this, socket, options, req, (err, socket) => {
        if (err) {
          req.onSocket(null, err);
        } else {
          setRequestSocket(this, req, socket);
          this.sockets[name].push(socket);
        }
      });
    } else {
      setRequestSocket(this, req, socket);
      this.sockets[name].push(socket);
    }
  } else if (sockLen < this.maxSockets &&
             this.totalSocketCount < this.maxTotalSockets) {
    // If we are under maxSockets create a new one.
    this.createSocket(req, options, (err, socket) => {
      if (err) {
        debug('call onSocket', sockLen, freeLen);
        req.onSocket(null, err);
      } else {
        if (shouldUseProxy) {
          maybeTunnelRequest(this, socket, options, req, (err, socket) => {
            if (err) {
              debug('call onSocket', sockLen, freeLen);
              req.onSocket(null, err);
            } else {
              setRequestSocket(this, req, socket);
            }
          });
        } else {
          setRequestSocket(this, req, socket);
        }
      }
    });
  } else {
    debug('wait for socket');
    // We are over limit so we'll add it to the queue.
    this.requests[name] ||= [];

    // Used to create sockets for pending requests from different origin
    req[kRequestOptions] = options;
    // Used to capture the original async context.
    req[kRequestAsyncResource] = new AsyncResource('QueuedRequest');

    this.requests[name].push(req);
  }
};

Agent.prototype.createSocket = function createSocket(req, options, cb) {
  options = { __proto__: null, ...options, ...this.options };
  if (options.socketPath)
    options.path = options.socketPath;

  normalizeServerName(options, req);

  const name = this.getName(options);
  options._agentKey = name;

  debug('createConnection', name);
  options.encoding = null;

  // When keepAlive is true, pass the related options to createConnection
  if (this.keepAlive) {
    options.keepAlive = this.keepAlive;
    options.keepAliveInitialDelay = this.keepAliveMsecs;
  }
  const shouldUseProxy = !!req.proxyTunnelPayload;
    
  if (!shouldUseProxy) {
    const oncreate = once((err, s) => {
      if (err)
        return cb(err);
      this.sockets[name] ||= [];
      this.sockets[name].push(s);
      this.totalSocketCount++;
      debug('sockets', name, this.sockets[name].length, this.totalSocketCount);
      installListeners(this, s, options);
      cb(null, s);
    });
    const newSocket = this.createConnection(options, oncreate);
    if (newSocket)
      oncreate(null, newSocket);
  } else {
    const newSocket = this.createConnection(options);
    this.sockets[name] ||= [];
    this.sockets[name].push(newSocket);
    this.totalSocketCount++;
    debug('sockets', name, this.sockets[name].length, this.totalSocketCount);
    installListeners(this, newSocket, options);
    cb(null, newSocket);
  }
};

function normalizeServerName(options, req) {
  if (!options.servername && options.servername !== '')
    options.servername = calculateServerName(options, req);
}

function calculateServerName(options, req) {
  let servername = options.host;
  const hostHeader = req.getHeader('host');
  if (hostHeader) {
    validateString(hostHeader, 'options.headers.host');

    // abc => abc
    // abc:123 => abc
    // [::1] => ::1
    // [::1]:123 => ::1
    if (hostHeader[0] === '[') {
      const index = hostHeader.indexOf(']');
      if (index === -1) {
        // Leading '[', but no ']'. Need to do something...
        servername = hostHeader;
      } else {
        servername = hostHeader.substring(1, index);
      }
    } else {
      servername = hostHeader.split(':', 1)[0];
    }
  }
  // Don't implicitly set invalid (IP) servernames.
  if (net.isIP(servername))
    servername = '';
  return servername;
}

function installListeners(agent, s, options) {
  function onFree() {
    debug('CLIENT socket onFree');
    agent.emit('free', s, options);
  }
  s.on('free', onFree);

  function onClose(err) {
    debug('CLIENT socket onClose');
    // This is the only place where sockets get removed from the Agent.
    // If you want to remove a socket from the pool, just close it.
    // All socket errors end in a close event anyway.
    agent.totalSocketCount--;
    agent.removeSocket(s, options);
  }
  s.on('close', onClose);

  function onTimeout() {
    debug('CLIENT socket onTimeout');

    // Destroy if in free list.
    // TODO(ronag): Always destroy, even if not in free list.
    const sockets = agent.freeSockets;
    if (ObjectKeys(sockets).some((name) => sockets[name].includes(s))) {
      return s.destroy();
    }
  }
  s.on('timeout', onTimeout);

  function onRemove() {
    // We need this function for cases like HTTP 'upgrade'
    // (defined by WebSockets) where we need to remove a socket from the
    // pool because it'll be locked up indefinitely
    debug('CLIENT socket onRemove');
    agent.totalSocketCount--;
    agent.removeSocket(s, options);
    s.removeListener('close', onClose);
    s.removeListener('free', onFree);
    s.removeListener('timeout', onTimeout);
    s.removeListener('agentRemove', onRemove);
  }
  s.on('agentRemove', onRemove);

  if (agent[kOnKeylog]) {
    s.on('keylog', agent[kOnKeylog]);
  }
}

Agent.prototype.removeSocket = function removeSocket(s, options) {
  const name = this.getName(options);
  debug('removeSocket', name, 'writable:', s.writable);
  const sets = [this.sockets];

  // If the socket was destroyed, remove it from the free buffers too.
  if (!s.writable)
    sets.push(this.freeSockets);

  for (let sk = 0; sk < sets.length; sk++) {
    const sockets = sets[sk];

    if (sockets[name]) {
      const index = sockets[name].indexOf(s);
      if (index !== -1) {
        sockets[name].splice(index, 1);
        // Don't leak
        if (sockets[name].length === 0)
          delete sockets[name];
      }
    }
  }

  let req;
  if (this.requests[name]?.length) {
    debug('removeSocket, have a request, make a socket');
    req = this.requests[name][0];
  } else {
    // TODO(rickyes): this logic will not be FIFO across origins.
    // There might be older requests in a different origin, but
    // if the origin which releases the socket has pending requests
    // that will be prioritized.
    const keys = ObjectKeys(this.requests);
    for (let i = 0; i < keys.length; i++) {
      const prop = keys[i];
      // Check whether this specific origin is already at maxSockets
      if (this.sockets[prop]?.length) break;
      debug('removeSocket, have a request with different origin,' +
        ' make a socket');
      req = this.requests[prop][0];
      options = req[kRequestOptions];
      break;
    }
  }

  if (req && options) {
    req[kRequestOptions] = undefined;
    // If we have pending requests and a socket gets closed make a new one
    this.createSocket(req, options, (err, socket) => {
      if (err)
        req.onSocket(null, err);
      else
        socket.emit('free');
    });
  }

};

Agent.prototype.keepSocketAlive = function keepSocketAlive(socket) {
  socket.setKeepAlive(true, this.keepAliveMsecs);
  socket.unref();

  let agentTimeout = this.options.timeout || 0;
  let canKeepSocketAlive = true;

  if (socket._httpMessage?.res) {
    const keepAliveHint = socket._httpMessage.res.headers['keep-alive'];

    if (keepAliveHint) {
      const hint = /^timeout=(\d+)/.exec(keepAliveHint)?.[1];

      if (hint) {
        // Let the timer expire before the announced timeout to reduce
        // the likelihood of ECONNRESET errors
        let serverHintTimeout = (NumberParseInt(hint) * 1000) - HTTP_AGENT_KEEP_ALIVE_TIMEOUT_BUFFER;
        serverHintTimeout = serverHintTimeout > 0 ? serverHintTimeout : 0;
        if (serverHintTimeout === 0) {
          // Cannot safely reuse the socket because the server timeout is
          // too short
          canKeepSocketAlive = false;
        } else if (serverHintTimeout < agentTimeout) {
          agentTimeout = serverHintTimeout;
        }
      }
    }
  }

  if (socket.timeout !== agentTimeout) {
    socket.setTimeout(agentTimeout);
  }

  return canKeepSocketAlive;
};

Agent.prototype.reuseSocket = function reuseSocket(socket, req) {
  debug('have free socket');
  socket.removeListener('error', freeSocketErrorListener);
  req.reusedSocket = true;
  socket.ref();
};

Agent.prototype.destroy = function destroy() {
  const sets = [this.freeSockets, this.sockets];
  for (let s = 0; s < sets.length; s++) {
    const set = sets[s];
    const keys = ObjectKeys(set);
    for (let v = 0; v < keys.length; v++) {
      const setName = set[keys[v]];
      for (let n = 0; n < setName.length; n++) {
        setName[n].destroy();
      }
    }
  }
};

function setRequestSocket(agent, req, socket) {
  req.onSocket(socket);
  const agentTimeout = agent.options.timeout || 0;
  if (req.timeout === undefined || req.timeout === agentTimeout) {
    return;
  }
  socket.setTimeout(req.timeout);
}

function asyncResetHandle(socket) {
  // Guard against an uninitialized or user supplied Socket.
  const handle = socket._handle;
  if (handle && typeof handle.asyncReset === 'function') {
    // Assign the handle a new asyncId and run any destroy()/init() hooks.
    handle.asyncReset(new ReusedHandle(handle.getProviderType(), handle));
    socket[async_id_symbol] = handle.getAsyncId();
  }
}

module.exports = {
  Agent,
  globalAgent: new Agent({ keepAlive: true, scheduling: 'lifo', timeout: 5000 }),
};
