interface RequestEntry {
  ts: number;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId: string | null;
  sessionId: string | null;
}

interface SessionEntry {
  startedAt: number;
  lastSeenAt: number;
  requests: number;
  userId?: string | null;
}

const store = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalMessages: 0,
  sessions: new Map<string, SessionEntry>(),
  requestLog: [] as RequestEntry[],
  REQUEST_LOG_MAX: 500,
};

function recordRequest(entry: RequestEntry): void {
  store.totalRequests += 1;

  if (entry.sessionId || entry.userId) {
    const key = entry.sessionId || entry.userId!;
    const now = Date.now();
    if (store.sessions.has(key)) {
      const s = store.sessions.get(key)!;
      s.lastSeenAt = now;
      s.requests += 1;
    } else {
      store.sessions.set(key, { startedAt: now, lastSeenAt: now, requests: 1, userId: entry.userId });
    }
  }

  store.requestLog.push({ ...entry });
  if (store.requestLog.length > store.REQUEST_LOG_MAX) {
    store.requestLog.shift();
  }
}

function recordMessage(): void {
  store.totalMessages += 1;
}

function pruneInactiveSessions(ttlMs = 30 * 60 * 1000): void {
  const cutoff = Date.now() - ttlMs;
  for (const [key, session] of store.sessions.entries()) {
    if (session.lastSeenAt < cutoff) {
      store.sessions.delete(key);
    }
  }
}

function getSnapshot() {
  return {
    uptime: {
      startedAt: new Date(store.startedAt).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - store.startedAt) / 1000),
    },
    sessions: {
      active: store.sessions.size,
    },
    messages: {
      total: store.totalMessages,
    },
    requests: {
      total: store.totalRequests,
    },
  };
}

export { store, recordRequest, recordMessage, pruneInactiveSessions, getSnapshot };
export type { RequestEntry, SessionEntry };
