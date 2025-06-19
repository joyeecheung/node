'use strict';

const {
  Date,
  NumberParseInt,
  Symbol,
  decodeURIComponent,
} = primordials;

const { setUnrefTimeout } = require('internal/timers');
const { getCategoryEnabledBuffer, trace } = internalBinding('trace_events');
const {
  CHAR_LOWERCASE_B,
  CHAR_LOWERCASE_E,
} = require('internal/constants');

const { URL } = require('internal/url');
const { Buffer } = require('buffer');
const { isIPv4 } = require('internal/net');
let utcCache;

function utcDate() {
  if (!utcCache) cache();
  return utcCache;
}

function cache() {
  const d = new Date();
  utcCache = d.toUTCString();
  setUnrefTimeout(resetCache, 1000 - d.getMilliseconds());
}

function resetCache() {
  utcCache = undefined;
}

let traceEventId = 0;

function getNextTraceEventId() {
  return ++traceEventId;
}

const httpEnabled = getCategoryEnabledBuffer('node.http');

function isTraceHTTPEnabled() {
  return httpEnabled[0] > 0;
}

const traceEventCategory = 'node,node.http';

function traceBegin(...args) {
  trace(CHAR_LOWERCASE_B, traceEventCategory, ...args);
}

function traceEnd(...args) {
  trace(CHAR_LOWERCASE_E, traceEventCategory, ...args);
}

function isIPv4InCIDR(ip, cidr) {
  const { 0: network, 1: prefixLength } = cidr.split('/');
  if (!network || !prefixLength) return false;

  const ipInt = ipToInt(ip);
  const networkInt = ipToInt(network);
  const mask = (0xFFFFFFFF << (32 - NumberParseInt(prefixLength, 10))) >>> 0;

  return (ipInt & mask) === (networkInt & mask);
}

function ipToInt(ip) {
  return ip.split('.').reduce((int, oct) => (int << 8) + NumberParseInt(oct, 10), 0) >>> 0;
}

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

/**
 * Represents the proxy configuration for an agent. The built-in http and https agent
 * implementation have one of this when they are configured to use a proxy.
 * @property {string} href - Full URL of the proxy server.
 * @property {string} host - Full host including port, e.g. 'localhost:8080'.
 * @property {string} hostname - Hostname without brackets for IPv6 addresses.
 * @property {number} port - Port number of the proxy server.
 * @property {string} protocol - Protocol of the proxy server, e.g. 'http:' or 'https:'.
 * @property {object} headers - Headers to be sent with the proxy request.
 * @property {Array<string>} bypassList - List of hosts to bypass the proxy.
 * @property {object} proxyConnectionOptions - Options for connecting to the proxy server.
 *                                             This may need to be extended with e.g. timeout
 *                                             or other connection options on a per-request basis.
 */
class ProxyConfig {
  constructor(proxyUrl, keepAlive, noProxyList) {
    const { host, hostname, port, protocol, username, password } = new URL(proxyUrl);
    this.href = proxyUrl; // Full URL of the proxy server.
    this.host = host; // Full host including port, e.g. 'localhost:8080'.
    this.hostname = hostname.replace(/^\[|\]$/g, ''); // Trim off the brackets from IPv6 addresses.
    this.port = port ? NumberParseInt(port, 10) : (protocol === 'https:' ? 443 : 80);
    this.protocol = protocol; // Protocol of the proxy server, e.g. 'http:' or 'https:'.
    this.headers = {
      'proxy-connection': keepAlive ? 'keep-alive' : 'close',
      '__proto__': null, // Prevent prototype pollution.
    };
    if (username || password) {
      // If username or password is provided, prepare the proxy-authorization header.
      const auth = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
      this.headers['proxy-authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
    }
    if (noProxyList) {
      this.bypassList = noProxyList.split(',').map((entry) => entry.trim().toLowerCase());
    } else {
      this.bypassList = []; // No bypass list provided.
    }
    this.proxyConnectionOptions = {
      host: this.hostname,
      port: this.port,
    };
  }

  shouldUseProxy(hostname, port) {
    const bypassList = this.bypassList;
    if (this.bypassList.length === 0) {
      return true; // No bypass list, always use the proxy.
    }

    const host = hostname.toLowerCase();
    const hostWithPort = port ? `${host}:${port}` : host;

    for (let i = 0; i < bypassList.length; i++) {
      const entry = bypassList[i];

      if (entry === '*') return false;
      if (entry === host || entry === hostWithPort) return false;

      // Handle domain wildcards like .example.com
      if (entry.startsWith('.') && host.endsWith(entry)) return false;

      // Handle wildcards like *.example.com
      if (entry.startsWith('*.') && host.endsWith(entry.substring(1))) return false;

      // Handle CIDR notation for IPv4 addresses
      if (entry.includes('/') && isIPv4(host)) {
        if (isIPv4InCIDR(host, entry)) return false;
      }

      // Handle IP ranges (simple format like 192.168.1.0-192.168.1.255)
      if (entry.includes('-') && isIPv4(host)) {
        const { 0: startIP, 1: endIP } = entry.split('-');
        if (startIP && endIP) {
          const hostInt = ipToInt(host);
          const startInt = ipToInt(startIP.trim());
          const endInt = ipToInt(endIP.trim());
          if (hostInt >= startInt && hostInt <= endInt) return false;
        }
      }
    }

    return true; // If no matches found, use the proxy.
  }
}

function parseProxyConfigFromEnv(env, protocol, keepAlive) {
  // We only support HTTP and HTTPS proxies for now.
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }
  // No environment variable set, no proxy.
  const proxyUrl = (protocol === 'https:') ?
    (env.HTTPS_PROXY || env.https_proxy) : (env.HTTP_PROXY || env.http_proxy);
  if (!proxyUrl) {
    return null;
  }

  const noProxyList = env.NO_PROXY || env.no_proxy;
  return new ProxyConfig(proxyUrl, keepAlive, noProxyList);
}

/**
 * @param {ProxyConfig} proxyConfig
 * @param {object} reqOptions
 * @returns {boolean}
 */
function checkShouldUseProxy(proxyConfig, reqOptions) {
  if (!proxyConfig) {
    return false;
  }
  return proxyConfig.shouldUseProxy(reqOptions.host || 'localhost', reqOptions.port);
}

module.exports = {
  kOutHeaders: Symbol('kOutHeaders'),
  kNeedDrain: Symbol('kNeedDrain'),
  kProxyConfig: Symbol('kProxyConfig'),
  kWaitForProxyTunnel: Symbol('kWaitForProxyTunnel'),
  checkShouldUseProxy,
  parseProxyConfigFromEnv,
  utcDate,
  traceBegin,
  traceEnd,
  getNextTraceEventId,
  isTraceHTTPEnabled,
};
