'use strict';

/**
 * @fileoverview In-memory telemetry store for StreamChat Bridge.
 * Maintains global counters, active sessions, and a bounded request log.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const RING_BUFFER_CAPACITY   = 500;
const SESSION_TTL_MS         = 30 * 60 * 1_000; // 30 minutes

// ─── Ring Buffer ──────────────────────────────────────────────────────────────

/**
 * A fixed-capacity circular buffer that overwrites the oldest entry when full.
 * @template T
 */
class RingBuffer {
  /**
   * @param {number} capacity Maximum number of entries to retain.
   */
  constructor(capacity) {
    /** @private @type {number} */
    this._capacity = capacity;
    /** @private @type {T[]} */
    this._buf = new Array(capacity);
    /** @private @type {number} */
    this._head = 0; // next write position
    /** @private @type {number} */
    this._size = 0;
  }

  /**
   * Append an entry, evicting the oldest one if at capacity.
   * @param {T} entry
   */
  push(entry) {
    this._buf[this._head] = entry;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) this._size++;
  }

  /**
   * Return all entries in chronological order (oldest → newest).
   * @returns {T[]}
   */
  toArray() {
    if (this._size === 0) return [];
    if (this._size < this._capacity) {
      return this._buf.slice(0, this._size);
    }
    // Buffer is full: data wraps around _head
    return [
      ...this._buf.slice(this._head),
      ...this._buf.slice(0, this._head),
    ];
  }

  /** @returns {number} */
  get size() { return this._size; }
}

// ─── Session Map ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SessionEntry
 * @property {string}  userId      Owning user identifier.
 * @property {number}  startedAt   Unix timestamp (ms) when session was created.
 * @property {number}  lastSeenAt  Unix timestamp (ms) of the most recent activity.
 * @property {number}  requests    Number of HTTP requests attributed to this session.
 * @property {number}  messages    Number of chat messages sent in this session.
 */

/**
 * Manages active sessions with automatic TTL pruning.
 */
class SessionStore {
  constructor() {
    /** @type {Map<string, SessionEntry>} */
    this._map = new Map();
  }

  /**
   * Upsert a session, refreshing `lastSeenAt` on every touch.
   * @param {string} sessionId
   * @param {string} userId
   */
  touch(sessionId, userId) {
    const now = Date.now();
    if (this._map.has(sessionId)) {
      const s = this._map.get(sessionId);
      s.lastSeenAt = now;
      s.requests++;
    } else {
      this._map.set(sessionId, {
        userId,
        startedAt:  now,
        lastSeenAt: now,
        requests:   1,
        messages:   0,
      });
    }
  }

  /**
   * Increment the message counter for a session.
   * @param {string} sessionId
   */
  recordMessage(sessionId) {
    const s = this._map.get(sessionId);
    if (s) s.messages++;
  }

  /**
   * Remove all sessions that have been inactive for longer than SESSION_TTL_MS.
   * @returns {number} Number of sessions removed.
   */
  prune() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let removed = 0;
    for (const [id, session] of this._map) {
      if (session.lastSeenAt < cutoff) {
        this._map.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * A plain-object snapshot safe for JSON serialisation.
   * @returns {Record<string, SessionEntry>}
   */
  snapshot() {
    return Object.fromEntries(this._map);
  }

  /** @returns {number} */
  get size() { return this._map.size; }
}

// ─── Telemetry Store (singleton) ──────────────────────────────────────────────

/**
 * @typedef {Object} RequestLogEntry
 * @property {string}  timestamp     ISO-8601 string.
 * @property {string}  method        HTTP method.
 * @property {string}  path          Request path (without query string).
 * @property {number}  status        HTTP response status code.
 * @property {number}  durationMs    Response time in milliseconds (2 decimal places).
 * @property {string|null} userId    Resolved user identifier, if available.
 * @property {string|null} sessionId Resolved session identifier, if available.
 */

const store = {
  /** @type {number} Unix timestamp (ms) when the process started. */
  startedAt: Date.now(),

  /** @type {number} Cumulative HTTP request counter. */
  totalRequests: 0,

  /** @type {number} Cumulative chat-message counter. */
  totalMessages: 0,

  /** @type {SessionStore} */
  sessions: new SessionStore(),

  /** @type {RingBuffer<RequestLogEntry>} */
  recentRequests: new RingBuffer(RING_BUFFER_CAPACITY),
};

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Increment the global request counter and touch the session.
 * Called once per incoming HTTP request by the telemetry middleware.
 *
 * @param {Object}      params
 * @param {string|null} params.userId
 * @param {string|null} params.sessionId
 */
function recordRequest({ userId, sessionId }) {
  store.totalRequests++;
  if (sessionId) {
    store.sessions.touch(sessionId, userId ?? 'anonymous');
  }
}

/**
 * Append a structured entry to the ring buffer.
 * @param {RequestLogEntry} entry
 */
function appendLog(entry) {
  store.recentRequests.push(entry);
}

/**
 * Increment the global message counter and the per-session counter.
 * Intended to be called from your chat controller.
 *
 * @param {Object}      [params={}]
 * @param {string|null} [params.sessionId]
 */
function recordMessage({ sessionId } = {}) {
  store.totalMessages++;
  if (sessionId) {
    store.sessions.recordMessage(sessionId);
  }
}

/**
 * Return a point-in-time snapshot of all telemetry data.
 * @returns {Object}
 */
function getSnapshot() {
  return {
    startedAt:      new Date(store.startedAt).toISOString(),
    uptimeSeconds:  Math.floor((Date.now() - store.startedAt) / 1_000),
    totalRequests:  store.totalRequests,
    totalMessages:  store.totalMessages,
    activeSessions: store.sessions.size,
    sessions:       store.sessions.snapshot(),
    recentRequests: store.recentRequests.toArray(),
  };
}

/**
 * Prune stale sessions (> 30 min of inactivity).
 * Safe to call on a recurring timer.
 * @returns {number} Sessions removed.
 */
function pruneSessions() {
  return store.sessions.prune();
}

module.exports = {
  recordRequest,
  appendLog,
  recordMessage,
  getSnapshot,
  pruneSessions,
};
