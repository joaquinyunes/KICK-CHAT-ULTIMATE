import type { Request, Response, NextFunction } from "express";
import { recordRequest } from "./store";

const LEVEL = {
  info: "\x1b[36mINFO \x1b[0m",
  warn: "\x1b[33mWARN \x1b[0m",
  error: "\x1b[31mERROR\x1b[0m",
};

function levelFor(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

function formatLog(entry: {
  ts: number;
  statusCode: number;
  durationMs: number;
  method: string;
  path: string;
  userId: string | null;
  sessionId: string | null;
}): string {
  const lvl = levelFor(entry.statusCode);
  const ts = new Date(entry.ts).toISOString();
  const dur = `${entry.durationMs}ms`.padStart(7);
  const status = String(entry.statusCode).padEnd(3);
  const route = `${entry.method.padEnd(6)} ${entry.path}`;
  const who = entry.userId
    ? `user=${entry.userId}`
    : entry.sessionId
      ? `sess=${entry.sessionId}`
      : "anonymous";

  return `${LEVEL[lvl]} ${ts}  ${status}  ${dur}  ${route}  ${who}`;
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  (res as any).on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    const userId =
      req.user?.id as string | undefined ||
      (req as any).userId as string | undefined ||
      String(req.headers["x-user-id"] ?? "") ||
      null;

    const sessionId =
      ((req as any).session as Record<string, unknown> | undefined)
        ?.id as string | undefined ||
      (req as any).sessionId as string | undefined ||
      String(req.headers["x-session-id"] ?? "") ||
      null;

    const entry = {
      ts: Date.now(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId,
      sessionId,
    };

    recordRequest(entry);
    console.log(formatLog(entry));
  });

  next();
}

export { requestLogger };
