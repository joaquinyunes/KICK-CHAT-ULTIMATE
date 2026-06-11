'use strict';

/**
 * @fileoverview Express middleware for request telemetry in StreamChat Bridge.
 * Captures high-resolution response time, extracts identity context, and
 * emits a structured JSON log line per request.
 */

const { recordRequest, appendLog } = require('./store');

// ─── Identity Extraction ──────────────────────────────────────────────────────

/**
 * Resolve the userId from the request.
 * Priority: Authorization header → custom header → body → query param.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractUserId(req) {
  // Bearer token header  →  "Bearer <userId>" (common in JWT-less token schemes)
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim() || null;
  }

  return (
    req.headers['x-user-id']              ||
    req.body?.userId                       ||
    req.body?.user_id                      ||
    req.query?.userId                      ||
    null
  );
}

/**
 * Resolve the sessionId from the request.
 * Priority: custom header → body → query param.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractSessionId(req) {
  return (
    req.headers['x-session-id']            ||
    req.body?.sessionId                    ||
    req.body?.session_id                   ||
    req.query?.sessionId                   ||
    null
  );
}

// ─── Middleware Factory ───────────────────────────────────────────────────────

/**
 * @typedef {Object} TelemetryMiddlewareOptions
 * @property {boolean} [logToConsole=true]  Emit the JSON log line to stdout.
 * @property {boolean} [quiet=false]        Suppress log output (useful in tests).
 */

/**
 * Returns an Express middleware that measures response time, records request
 * metrics, and logs a structured JSON entry per request.
 *
 * @param {TelemetryMiddlewareOptions} [options={}]
 * @returns {import('express').RequestHandler}
 *
 * @example
 * const { telemetryMiddleware } = require('./telemetry');
 * app.use(telemetryMiddleware());
 */
function telemetryMiddleware(options = {}) {
  const { logToConsole = true, quiet = false } = options;

  return function _telemetry(req, res, next) {
    const startNs = process.hrtime.bigint(); // nanosecond precision

    const userId    = extractUserId(req);
    const sessionId = extractSessionId(req);

    // Register the request immediately so counters stay consistent even if
    // the handler throws before the response finishes.
    recordRequest({ userId, sessionId });

    // Hook into the 'finish' event so we capture the true end of the response.
    res.on('finish', () => {
      const endNs      = process.hrtime.bigint();
      const durationMs = Number(endNs - startNs) / 1_000_000; // ns → ms

      /** @type {import('./store').RequestLogEntry} */
      const entry = {
        timestamp:  new Date().toISOString(),
        method:     req.method,
        path:       req.path,
        status:     res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100, // 2 decimal places
        userId,
        sessionId,
      };

      appendLog(entry);

      if (logToConsole && !quiet) {
        // One JSON line per request — easy to pipe into any log aggregator.
        process.stdout.write(JSON.stringify({
          level:  statusToLevel(res.statusCode),
          source: 'telemetry',
          ...entry,
        }) + '\n');
      }
    });

    next();
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map an HTTP status code to a log severity level.
 * @param {number} status
 * @returns {'info'|'warn'|'error'}
 */
function statusToLevel(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

module.exports = { telemetryMiddleware };
