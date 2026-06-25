import { timingSafeEqual } from "crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { getSnapshot, pruneInactiveSessions, store } from "./store";
import { logger } from "../utils/logger";

const router = Router();

function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    logger.error("telemetry", "ADMIN_SECRET env var is not set — metrics endpoint is locked.");
    res.status(503).json({ error: "Metrics endpoint is not configured (ADMIN_SECRET missing)." });
    return;
  }

  const provided = String(req.headers["x-admin-secret"] ?? "");

  if (!provided) {
    res.status(401).json({ error: "Missing required header: x-admin-secret" });
    return;
  }

  const expected = Buffer.from(secret);
  const given = Buffer.from(provided);

  if (expected.length !== given.length) {
    res.status(403).json({ error: "Invalid admin secret." });
    return;
  }

  if (!timingSafeEqual(expected, given)) {
    res.status(403).json({ error: "Invalid admin secret." });
    return;
  }

  next();
}

router.get("/status/metrics", requireAdminSecret, (_req: Request, res: Response) => {
  pruneInactiveSessions();

  const snapshot = getSnapshot();

  const recentRequests = [...store.requestLog]
    .reverse()
    .slice(0, 20)
    .map(({ ts, method, path, statusCode, durationMs, userId, sessionId }) => ({
      ts: new Date(ts).toISOString(),
      method,
      path,
      statusCode,
      durationMs,
      ...(userId && { userId }),
      ...(sessionId && { sessionId }),
    }));

  res.json({ ...snapshot, recentRequests });
});

export default router;
