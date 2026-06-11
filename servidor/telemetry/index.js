'use strict';

/**
 * @fileoverview Public API for the StreamChat Bridge Telemetry module.
 *
 * This is the only file your application code should import.
 * Everything else (store, middleware internals) is an implementation detail.
 *
 * @example — Wiring up Express
 * ```js
 * const express = require('express');
 * const {
 *   telemetryMiddleware,
 *   metricsRouter,
 *   startPruneTimer,
 * } = require('./telemetry');
 *
 * const app = express();
 * app.use(express.json());
 *
 * // 1. Attach telemetry middleware before your routes.
 * app.use(telemetryMiddleware());
 *
 * // 2. Mount the /status/metrics endpoint.
 * app.use(metricsRouter);
 *
 * // 3. Start the background session-pruning timer.
 * startPruneTimer();
 * ```
 *
 * @example — Recording a message from your chat controller
 * ```js
 * const { recordMessage } = require('./telemetry');
 *
 * async function handleChatMessage(req, res) {
 *   const { sessionId } = req.body;
 *   // … process the message …
 *   recordMessage({ sessionId });
 *   res.json({ ok: true });
 * }
 * ```
 */

const { recordMessage, getSnapshot, pruneSessions } = require('./store');
const { telemetryMiddleware }                       = require('./middleware');
const { metricsRouter }                             = require('./metricsRouter');

// ─── Background Pruning ───────────────────────────────────────────────────────

/** @type {NodeJS.Timeout|null} */
let _pruneTimer = null;

/**
 * Start a background interval that prunes sessions inactive for > 30 min.
 * Call once during application startup. Safe to call multiple times (idempotent).
 *
 * @param {number} [intervalMs=10 * 60 * 1000]  How often to run the pruner (default: 10 min).
 * @returns {() => void} A `stop` function that clears the timer.
 */
function startPruneTimer(intervalMs = 10 * 60 * 1_000) {
  if (_pruneTimer) return () => clearInterval(_pruneTimer);

  _pruneTimer = setInterval(() => {
    const removed = pruneSessions();
    if (removed > 0) {
      process.stdout.write(
        JSON.stringify({
          level:   'info',
          source:  'telemetry:prune',
          message: `Pruned ${removed} stale session(s).`,
          ts:      new Date().toISOString(),
        }) + '\n',
      );
    }
  }, intervalMs);

  // Allow the process to exit cleanly even if the timer is still running.
  _pruneTimer.unref();

  return function stop() {
    clearInterval(_pruneTimer);
    _pruneTimer = null;
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  /**
   * Express middleware — must be registered with `app.use()` before your routes.
   * Measures response time, extracts userId/sessionId, and logs each request.
   *
   * @type {typeof telemetryMiddleware}
   */
  telemetryMiddleware,

  /**
   * Express Router — mount with `app.use(metricsRouter)` to expose
   * `GET /status/metrics`.
   *
   * @type {import('express').Router}
   */
  metricsRouter,

  /**
   * Increment the global message counter (and per-session counter if a
   * sessionId is provided). Call this from your chat message handler.
   *
   * @type {typeof recordMessage}
   */
  recordMessage,

  /**
   * Return a full telemetry snapshot (counters, sessions, recent requests).
   * Useful for health-check endpoints or internal dashboards.
   *
   * @type {typeof getSnapshot}
   */
  getSnapshot,

  /**
   * Start the background session-pruning interval.
   * Returns a `stop()` function for graceful shutdown.
   *
   * @type {typeof startPruneTimer}
   */
  startPruneTimer,
};
