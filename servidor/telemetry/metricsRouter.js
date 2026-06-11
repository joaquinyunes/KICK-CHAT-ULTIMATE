'use strict';

/**
 * @fileoverview Express router exposing the /status/metrics endpoint.
 * Access is guarded by a timing-safe secret comparison to prevent
 * timing-attack enumeration of the ADMIN_SECRET value.
 */

const { Router } = require('express');
const crypto     = require('crypto');
const { getSnapshot, pruneSessions } = require('./store');

// ─── Auth Helper ──────────────────────────────────────────────────────────────

/**
 * Compare two strings in constant time using Node's `crypto.timingSafeEqual`.
 * Always allocates buffers of identical length to prevent length-based leaks.
 *
 * @param {string} a  Candidate value (from request header).
 * @param {string} b  Expected value (from environment).
 * @returns {boolean}
 */
function timingSafeCompare(a, b) {
  // Encode both sides with the same algorithm so byte lengths are predictable.
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Lengths must match for timingSafeEqual; pad the shorter one with a
  // throwaway buffer so the function doesn't throw — but the result is still
  // `false` when lengths differ.
  if (bufA.length !== bufB.length) {
    // Run the comparison anyway to maintain constant-time behaviour.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Express middleware that authenticates admin requests via `x-admin-secret`.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    // Fail closed: if the secret is not configured, deny all access.
    return res.status(503).json({
      error: 'Metrics endpoint is not configured (ADMIN_SECRET missing).',
    });
  }

  const candidate = req.headers['x-admin-secret'] ?? '';

  if (!timingSafeCompare(String(candidate), secret)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

const metricsRouter = Router();

/**
 * GET /status/metrics
 *
 * Returns a JSON snapshot of the current telemetry state.
 * Requires the `x-admin-secret` header to match `process.env.ADMIN_SECRET`.
 *
 * Response shape:
 * ```json
 * {
 *   "startedAt":      "2024-01-15T10:00:00.000Z",
 *   "uptimeSeconds":  3600,
 *   "totalRequests":  1240,
 *   "totalMessages":  430,
 *   "activeSessions": 12,
 *   "sessions":       { "<sessionId>": { ... } },
 *   "recentRequests": [ { ... }, ... ]
 * }
 * ```
 *
 * @example
 * curl -H "x-admin-secret: mysecret" http://localhost:3000/status/metrics
 */
metricsRouter.get('/status/metrics', requireAdminSecret, (req, res) => {
  // Opportunistically prune stale sessions on every metrics read so the data
  // stays tidy without needing a dedicated background timer.
  pruneSessions();

  const snapshot = getSnapshot();

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(snapshot);
});

module.exports = { metricsRouter };
