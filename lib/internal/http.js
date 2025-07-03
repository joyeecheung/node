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

function ipToInt(ip) {
  // Split the address into its four dotted-decimal octets
  const octets = ip.split('.');
  let result = 0;
  for (let i = 0; i < octets.length; i++) {
    result = (result << 8) + NumberParseInt(octets[i]);
  }
  // Force unsigned 32-bit result
  return result >>> 0;
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
// When the proxy protocol is HTTP, the modified HTTP request can just be sent over
// the TCP socket to the proxy server, and the HTTPS request tunnel can be established
// over the TCP socket to the proxy server.
// When the proxy protocol is HTTPS, the modified request needs to be sent after
// TLS handshake with the proxy server. Same goes to the HTTPS request tunnel establishment.

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

  // See: https://about.gitlab.com/blog/we-need-to-talk-no-proxy
  shouldUseProxy(hostname, port) {
    const bypassList = this.bypassList;
    if (this.bypassList.length === 0) {
      return true; // No bypass list, always use the proxy.
    }

    const host = hostname.toLowerCase();
    const hostWithPort = port ? `${host}:${port}` : host;

    for (let i = 0; i < bypassList.length; i++) {
      const entry = bypassList[i];

      if (entry === '*') return false;  // * bypasses all hosts.
      if (entry === host || entry === hostWithPort) return false;  // Matching host and host:port

      // Follow curl's behavior: strip leading dot before matching suffixes.
      if (entry.startsWith('.')) {
        const suffix = entry.substring(1);
        if (host.endsWith(suffix)) return false;
      }

      // Handle wildcards like *.example.com
      if (entry.startsWith('*.') && host.endsWith(entry.substring(1))) return false;

      // Handle IP ranges (simple format like 192.168.1.0-192.168.1.255)
      // TODO(joyeecheung): support IPv6.
      if (entry.includes('-') && isIPv4(host)) {
        let { 0: startIP, 1: endIP } = entry.split('-');
        startIP = startIP.trim();
        endIP = endIP.trim();
        if (startIP && endIP && isIPv4(startIP) && isIPv4(endIP)) {
          const hostInt = ipToInt(host);
          const startInt = ipToInt(startIP);
          const endInt = ipToInt(endIP);
          if (hostInt >= startInt && hostInt <= endInt) return false;
        }
      }

      // It might be useful to support CIDR notation, but it's not so widely supported
      // in other tools as a de-facto standard to follow, so we don't implement it for now.
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
    (env.https_proxy || env.HTTPS_PROXY) : (env.http_proxy || env.HTTP_PROXY);
  if (!proxyUrl) {
    return null;
  }

  const noProxyList = env.no_proxy || env.NO_PROXY;
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
  if (reqOptions.socketPath) {
    // If socketPath is set, we are using a Unix domain socket, so no proxy.
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
