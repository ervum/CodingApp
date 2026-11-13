const net = require('node:net');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = Number(process.env.PORT || 3000);
const BACKEND_TARGET = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

/**
 * Shared single-flight waiter that resolves true as soon as the backend TCP port is accepting connections,
 * or false if it does not come up within `timeoutMs`.
 */
let pendingWaitPromise = null;

function waitForBackendPort(timeoutMs = 25000) {
  if (pendingWaitPromise) {
    return pendingWaitPromise;
  }

  pendingWaitPromise = new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const tryConnect = () => {
      const sock = net.createConnection({ host: BACKEND_HOST, port: BACKEND_PORT });
      let settled = false;

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        if (ok) {
          pendingWaitPromise = null;
          resolve(true);
        } else if (Date.now() < deadline) {
          setTimeout(tryConnect, 300);
        } else {
          pendingWaitPromise = null;
          resolve(false);
        }
      };

      sock.setTimeout(600);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
    };

    tryConnect();
  });

  return pendingWaitPromise;
}

function isTransientConnectionError(err) {
  if (!err) return false;
  const code = err.code || '';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT'
  ) {
    return true;
  }
  if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
    return err.errors.some((e) => isTransientConnectionError(e));
  }
  const msg = String(err.message || err.stack || '');
  return msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET');
}

function canSafelyRetryHttpRequest(req) {
  if (!req || req.__retriedAfterBackendReady) return false;
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }
  const contentLength = req.headers && req.headers['content-length'];
  if (!contentLength || contentLength === '0') {
    return true;
  }
  return false;
}

function configureResilientProxy(proxy, opts) {
  const origEmit = proxy.emit.bind(proxy);

  proxy.emit = function (event, ...args) {
    if (event === 'error') {
      const [err, req, res] = args;
      if (isTransientConnectionError(err)) {
        // HTTP ServerResponse vs WebSocket net.Socket
        if (res && typeof res.writeHead === 'function') {
          if (canSafelyRetryHttpRequest(req)) {
            req.__retriedAfterBackendReady = true;
            waitForBackendPort(25000).then((ready) => {
              if (res.writableEnded || res.destroyed) return;
              if (ready) {
                proxy.web(req, res, opts);
              } else if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    code: 'BACKEND_UNAVAILABLE',
                    message: 'Backend server is starting or restarting. Please retry in a moment.',
                  }),
                );
              }
            });
            return true;
          }

          if (!res.headersSent && !res.writableEnded) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                code: 'BACKEND_UNAVAILABLE',
                message: 'Backend server is starting or restarting. Please retry in a moment.',
              }),
            );
          }
          return true;
        }

        // WebSocket upgrade socket: close quietly so socket.io-client reconnects cleanly without Vite error spam
        if (res && typeof res.end === 'function') {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
        return true;
      }
    }
    return origEmit(event, ...args);
  };
}

module.exports = {
  '/api': {
    target: BACKEND_TARGET,
    secure: false,
    changeOrigin: true,
    configure: configureResilientProxy,
  },
  '/socket.io': {
    target: BACKEND_TARGET,
    secure: false,
    ws: true,
    changeOrigin: true,
    configure: configureResilientProxy,
  },
};
