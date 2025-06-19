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
  ArrayPrototypeIndexOf,
  ArrayPrototypePush,
  ArrayPrototypeShift,
  ArrayPrototypeSplice,
  ArrayPrototypeUnshift,
  FunctionPrototypeCall,
  JSONStringify,
  ObjectAssign,
  ObjectKeys,
  ObjectSetPrototypeOf,
  ReflectApply,
  ReflectConstruct,
  SymbolAsyncDispose,
} = primordials;

const {
  assertCrypto,
  kEmptyObject,
  promisify,
} = require('internal/util');
assertCrypto();

const tls = require('tls');
const {
  kProxyConfig,
  kWaitForProxyTunnel,
  checkShouldUseProxy,
} = require('internal/http');
const { Agent: HttpAgent } = require('_http_agent');
const {
  httpServerPreClose,
  Server: HttpServer,
  setupConnectionsTracking,
  storeHTTPOptions,
  _connectionListener,
} = require('_http_server');
const { ClientRequest } = require('_http_client');
let debug = require('internal/util/debuglog').debuglog('https', (fn) => {
  debug = fn;
});
const net = require('net');
const { _normalizeArgs: normalizeArgs } = net;
const { URL, urlToHttpOptions, isURL } = require('internal/url');
const { validateObject } = require('internal/validators');
const { ERR_PROXY_TUNNEL } = require('internal/errors').codes;

function Server(opts, requestListener) {
  if (!(this instanceof Server)) return new Server(opts, requestListener);

  let ALPNProtocols = ['http/1.1'];
  if (typeof opts === 'function') {
    requestListener = opts;
    opts = kEmptyObject;
  } else if (opts == null) {
    opts = kEmptyObject;
  } else {
    validateObject(opts, 'options');
    // Only one of ALPNProtocols and ALPNCallback can be set, so make sure we
    // only set a default ALPNProtocols if the caller has not set either of them
    if (opts.ALPNProtocols || opts.ALPNCallback)
      ALPNProtocols = undefined;
  }

  FunctionPrototypeCall(storeHTTPOptions, this, opts);
  FunctionPrototypeCall(tls.Server, this,
                        {
                          noDelay: true,
                          ALPNProtocols,
                          ...opts,
                        },
                        _connectionListener);

  this.httpAllowHalfOpen = false;

  if (requestListener) {
    this.addListener('request', requestListener);
  }

  this.addListener('tlsClientError', function addListener(err, conn) {
    if (!this.emit('clientError', err, conn))
      conn.destroy(err);
  });

  this.timeout = 0;
  this.maxHeadersCount = null;
  this.on('listening', setupConnectionsTracking);
}

ObjectSetPrototypeOf(Server.prototype, tls.Server.prototype);
ObjectSetPrototypeOf(Server, tls.Server);

Server.prototype.closeAllConnections = HttpServer.prototype.closeAllConnections;

Server.prototype.closeIdleConnections = HttpServer.prototype.closeIdleConnections;

Server.prototype.setTimeout = HttpServer.prototype.setTimeout;

Server.prototype.close = function close() {
  httpServerPreClose(this);
  ReflectApply(tls.Server.prototype.close, this, arguments);
  return this;
};

Server.prototype[SymbolAsyncDispose] = async function() {
  await FunctionPrototypeCall(promisify(this.close), this);
};

/**
 * Creates a new `https.Server` instance.
 * @param {{
 *   IncomingMessage?: IncomingMessage;
 *   ServerResponse?: ServerResponse;
 *   insecureHTTPParser?: boolean;
 *   maxHeaderSize?: number;
 *   }} [opts]
 * @param {Function} [requestListener]
 * @returns {Server}
 */
function createServer(opts, requestListener) {
  return new Server(opts, requestListener);
}

// Generate proxyTunnelPayload and proxyTunnelOptions for HTTPS requests
function prepareForHttpsProxy(agent, reqOptions) {
  if (!agent[kProxyConfig]) {
    return null;
  }
  if ((reqOptions.protocol || agent.protocol) !== 'https:') {
    return null;
  }
  const shouldUseProxy = checkShouldUseProxy(agent[kProxyConfig], reqOptions);
  debug(`prepareForHttpsProxy should use proxy for ${reqOptions.host}:${reqOptions.port}:`, shouldUseProxy);
  if (!shouldUseProxy) {
    return null;
  }
  const { headers, href } = agent[kProxyConfig];
  // The request is a HTTPS request, assemble the payload for establishing the tunnel.
  const requestHost = net.isIPv6(reqOptions.host) ? `[${reqOptions.host}]` : reqOptions.host;
  let payload = `CONNECT ${requestHost}:${reqOptions.port} HTTP/1.1\r\n`;
  const keys = ObjectKeys(headers);
  for (let i = 0; i < keys.length; ++i) {
    const key = keys[i];
    payload += `${key}: ${headers[key]}\r\n`;
  }
  payload += `host: ${requestHost}:${reqOptions.port}`;
  payload += `\r\n\r\n`;

  const result = {
    proxyTunnelPayload: payload,  // Payload to be sent for CONNECT to the proxy server
    proxyTunnelOptions: {  // The options used for the TLS handshake for the request over the tunnel.
      __proto__: null,
      servername: reqOptions.servername || (net.isIP(reqOptions.host) ? undefined : reqOptions.host),
      ...reqOptions,
    },
    __proto__: null,
  };
  debug(`updated request for HTTPS proxy ${href} with`, result);
  return result;
};

const kTunnelEstablished = Symbol('kTunnelEstablished');
function establishTunnel(agent, socket, options, tunnelConfig, afterTunnel) {
  if (socket[kTunnelEstablished]) {
    debug('Tunnel already established, skipping');
    // If the tunnel is already established, we can proceed with the request.
    return afterTunnel(null, socket);
  }

  // By default, the socket is in paused mode. Read to look for the 200
  // connection established response.
  // TODO(joyeecheung): can this end up being in flowing mode?
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
    socket.setTimeout(0);  // Clear the timeout for the tunnel establishment.
  }

  function onProxyError(err) {
    debug('onProxyError', err);
    cleanup();
    afterTunnel(err, socket);
  }

  // Read the headers from the chunks and check for the status code. If it fails we
  // clean up the socket and return an error. Otherwise we establish the tunnel.
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
      const targetHost = tunnelConfig.proxyTunnelPayload.split('\r')[0].split(' ')[1];
      const message = `Failed to establish tunnel to ${targetHost} via ${agent[kProxyConfig].href}: ${statusLine}`;
      const err = new ERR_PROXY_TUNNEL(message);
      // TODO(joyeecheung): this should pass socket instead.
      afterTunnel(err, null);
    } else {
      // RFC 9110 says that it can be 2xx but in reality 200 should be the only one that
      // we'll typically see.
      // Proxy servers are not supposed to send anything after the headers - the payload must be
      // be empty. So after this point we will proceed with the tunnel e.g. with TLS handshake.
      debug('onProxyData receives 200, establishing tunnel');
      cleanup();
      // socket.proxyTunnelPayload = tunnelConfig.proxyTunnelPayload;
      afterTunnel(null, socket);
    }
    return headerEndIndex;
  }

  function onProxyEnd() {
    cleanup();
    const err = new ERR_PROXY_TUNNEL('Connection to establish proxy tunnel ended unexpectedly');
    afterTunnel(err, socket);
  }

  socket.on('error', onProxyError);
  socket.on('end', onProxyEnd);
  const timeout = options.timeout || agent.options.timeout || 0;
  if (timeout > 0) {
    debug(`proxy tunnel setTimeout for ${timeout}ms`);
    // It may be worth a separate timeout error/event.
    // But it also makes sense to treat the tunnel establishment timeout as
    // a normal timeout for the request.
    socket.setTimeout(timeout, () => {
      cleanup();
      const err = new ERR_PROXY_TUNNEL(`Connection to establish proxy tunnel timed out after ${timeout}ms`);
      err.timeout = timeout;  // TODO(joyeecheung): just use a different error?
      afterTunnel(err, socket);
    });
  }

  socket.write(tunnelConfig.proxyTunnelPayload);
  read();
}

function createConnection(...args) {
  const normalized = normalizeArgs(args);
  let options = normalized[0];
  const cb = normalized[1];
  debug('createConnection', options);

  if (options._agentKey) {
    const session = this._getSession(options._agentKey);
    if (session) {
      debug('reuse session for %j', options._agentKey);
      options = {
        session,
        ...options,
      };
    }
  }

  let socket;
  const tunnelConfig = prepareForHttpsProxy(this, options);

  if (!tunnelConfig) {
    // No proxy, just start a TLS connection.
    socket = tls.connect(options);
  } else {
    // Proxy is configured, create a tunnel to the proxy server.
    const proxyProtocol = this[kProxyConfig].protocol;
    const proxyConnectionOptions = {
      ...this[kProxyConfig].proxyConnectionOptions,
      timeout: options.timeout || this.options.timeout || undefined,
    };
    debug('Create proxy socket for tunnel', proxyConnectionOptions, tunnelConfig);
    const onConnect = () => {
      debug('Connected to proxy server', proxyConnectionOptions);
      socket.removeListener('error', onError);
      establishTunnel(this, socket, options, tunnelConfig, (err, s) => {
        if (err && cb) {
          debug('Failed to establish tunnel', err);
          return cb(err, s);
        }
        socket[kTunnelEstablished] = true;
        // If the tunnel is established successfully, we can proceed with the request.
        // Reuse the socket to perform the HTTPS handshake, then send the request.
        const tlsOptions = tunnelConfig.proxyTunnelOptions;
        tlsOptions.socket = socket;

        debug('established tunnel to proxy server', this[kProxyConfig].href, 'performing TLS handshake', tlsOptions);
        let tunneldSocket;
        function onTLSError(err) {
          debug('TLS handshake over proxy tunnel errored', err);
          if (cb) {
            cb(err);
          }
          tunneldSocket.removeListener('error', onTLSError);
        }
        tunneldSocket = tls.connect(tlsOptions, (err) => {
          debug('HTTPS handshake over proxy tunnel', err);
          tunneldSocket.removeListener('error', onTLSError);
          if (cb) {
            cb(err, tunneldSocket);
          }
        });
        // tunneldSocket.on('free', () => {
        //   socket.emit('free');
        // });
        // Replay the 'error' event from the tunneldSocket to the original socket.
        tunneldSocket.on('error', onTLSError);
      });
    };
    // If the proxy protocol is HTTP, we can establish the tunnel over a TCP connection directly.
    // Otherwise, the tunnel needs to be established over a TLS connection.
    if (proxyProtocol === 'http:') {
      socket = net.connect(proxyConnectionOptions, onConnect);
    } else {
      socket = tls.connect(proxyConnectionOptions, onConnect);
    }
    function onError(err) {
      debug('failed to connect to proxy server', err);
      if (cb) {
        cb(err);
      }
      socket.removeListener('error', onError);
    }
    socket.on('error', onError);
    socket[kWaitForProxyTunnel] = true;
  }

  if (options._agentKey) {
    // Cache new session for reuse
    socket.on('session', (session) => {
      this._cacheSession(options._agentKey, session);
    });

    // Evict session on error
    socket.once('close', (err) => {
      if (err)
        this._evictSession(options._agentKey);
    });
  }
  return socket;
}

/**
 * Creates a new `HttpAgent` instance.
 * @param {{
 *   keepAlive?: boolean;
 *   keepAliveMsecs?: number;
 *   maxSockets?: number;
 *   maxTotalSockets?: number;
 *   maxFreeSockets?: number;
 *   scheduling?: string;
 *   timeout?: number;
 *   maxCachedSessions?: number;
 *   servername?: string;
 *   }} [options]
 * @constructor
 */
function Agent(options) {
  if (!(this instanceof Agent))
    return new Agent(options);

  // TODO(joyeecheung): use symbol property?
  options = { __proto__: null, ...options };
  options.defaultPort = 443;
  options.protocol = 'https:';
  FunctionPrototypeCall(HttpAgent, this, options);

  this.maxCachedSessions = this.options.maxCachedSessions;
  if (this.maxCachedSessions === undefined)
    this.maxCachedSessions = 100;

  this._sessionCache = {
    map: {},
    list: [],
  };
}
ObjectSetPrototypeOf(Agent.prototype, HttpAgent.prototype);
ObjectSetPrototypeOf(Agent, HttpAgent);
Agent.prototype.createConnection = createConnection;

/**
 * Gets a unique name for a set of options.
 * @param {{
 *   host: string;
 *   port: number;
 *   localAddress: string;
 *   family: number;
 *   }} [options]
 * @returns {string}
 */
Agent.prototype.getName = function getName(options = kEmptyObject) {
  let name = FunctionPrototypeCall(HttpAgent.prototype.getName, this, options);

  name += ':';
  if (options.ca)
    name += options.ca;

  name += ':';
  if (options.cert)
    name += options.cert;

  name += ':';
  if (options.clientCertEngine)
    name += options.clientCertEngine;

  name += ':';
  if (options.ciphers)
    name += options.ciphers;

  name += ':';
  if (options.key)
    name += options.key;

  name += ':';
  if (options.pfx)
    name += options.pfx;

  name += ':';
  if (options.rejectUnauthorized !== undefined)
    name += options.rejectUnauthorized;

  name += ':';
  if (options.servername && options.servername !== options.host)
    name += options.servername;

  name += ':';
  if (options.minVersion)
    name += options.minVersion;

  name += ':';
  if (options.maxVersion)
    name += options.maxVersion;

  name += ':';
  if (options.secureProtocol)
    name += options.secureProtocol;

  name += ':';
  if (options.crl)
    name += options.crl;

  name += ':';
  if (options.honorCipherOrder !== undefined)
    name += options.honorCipherOrder;

  name += ':';
  if (options.ecdhCurve)
    name += options.ecdhCurve;

  name += ':';
  if (options.dhparam)
    name += options.dhparam;

  name += ':';
  if (options.secureOptions !== undefined)
    name += options.secureOptions;

  name += ':';
  if (options.sessionIdContext)
    name += options.sessionIdContext;

  name += ':';
  if (options.sigalgs)
    name += JSONStringify(options.sigalgs);

  name += ':';
  if (options.privateKeyIdentifier)
    name += options.privateKeyIdentifier;

  name += ':';
  if (options.privateKeyEngine)
    name += options.privateKeyEngine;

  return name;
};

Agent.prototype._getSession = function _getSession(key) {
  return this._sessionCache.map[key];
};

Agent.prototype._cacheSession = function _cacheSession(key, session) {
  // Cache is disabled
  if (this.maxCachedSessions === 0)
    return;

  // Fast case - update existing entry
  if (this._sessionCache.map[key]) {
    this._sessionCache.map[key] = session;
    return;
  }

  // Put new entry
  if (this._sessionCache.list.length >= this.maxCachedSessions) {
    const oldKey = ArrayPrototypeShift(this._sessionCache.list);
    debug('evicting %j', oldKey);
    delete this._sessionCache.map[oldKey];
  }

  ArrayPrototypePush(this._sessionCache.list, key);
  this._sessionCache.map[key] = session;
};

Agent.prototype._evictSession = function _evictSession(key) {
  const index = ArrayPrototypeIndexOf(this._sessionCache.list, key);
  if (index === -1)
    return;

  ArrayPrototypeSplice(this._sessionCache.list, index, 1);
  delete this._sessionCache.map[key];
};

const globalAgent = new Agent({
  keepAlive: true, scheduling: 'lifo', timeout: 5000,
  useEnvProxy: true,
});

/**
 * Makes a request to a secure web server.
 * @param {...any} args
 * @returns {ClientRequest}
 */
function request(...args) {
  let options = {};

  if (typeof args[0] === 'string') {
    const urlStr = ArrayPrototypeShift(args);
    options = urlToHttpOptions(new URL(urlStr));
  } else if (isURL(args[0])) {
    options = urlToHttpOptions(ArrayPrototypeShift(args));
  }

  if (args[0] && typeof args[0] !== 'function') {
    ObjectAssign(options, ArrayPrototypeShift(args));
  }

  options._defaultAgent = module.exports.globalAgent;
  ArrayPrototypeUnshift(args, options);

  return ReflectConstruct(ClientRequest, args);
}

/**
 * Makes a GET request to a secure web server.
 * @param {string | URL} input
 * @param {{
 *   agent?: Agent | boolean;
 *   auth?: string;
 *   createConnection?: Function;
 *   defaultPort?: number;
 *   family?: number;
 *   headers?: object;
 *   hints?: number;
 *   host?: string;
 *   hostname?: string;
 *   insecureHTTPParser?: boolean;
 *   joinDuplicateHeaders?: boolean;
 *   localAddress?: string;
 *   localPort?: number;
 *   lookup?: Function;
 *   maxHeaderSize?: number;
 *   method?: string;
 *   path?: string;
 *   port?: number;
 *   protocol?: string;
 *   setHost?: boolean;
 *   socketPath?: string;
 *   timeout?: number;
 *   signal?: AbortSignal;
 *   uniqueHeaders?: Array;
 *   } | string | URL} [options]
 * @param {Function} [cb]
 * @returns {ClientRequest}
 */
function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

module.exports = {
  Agent,
  globalAgent,
  Server,
  createServer,
  get,
  request,
};
