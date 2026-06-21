/**
 * middleware/rate-limiter.ts
 * * StreamChat Bridge — Fase 3
 * Rate Limiter: Protección server-side contra spam en Kick.
 *
 * Regla de oro: Nunca más de 1 mensaje cada INTERVAL_MS,
 * sin importar cuántas veces el cliente llame al endpoint.
 */

import type { Request, Response, NextFunction } from "express";

const INTERVAL_MS = 0; // Sin restricción entre mensajes

interface RateLimitEntry {
  lastSentAt: number; // timestamp del último mensaje permitido
}

// Mapa por sessionId (o userId) → entry.
const store = new Map<string, RateLimitEntry>();

/**
 * Lógica centralizada para el control de flujo de mensajes
 */
export class RateLimiter {
  static canSend(sessionId: string): boolean {
    const now = Date.now();
    const entry = store.get(sessionId);

    if (!entry) return true;
    return now - entry.lastSentAt >= INTERVAL_MS;
  }

  static recordSend(sessionId: string): void {
    store.set(sessionId, { lastSentAt: Date.now() });
  }

  static secondsUntilNext(sessionId: string): number {
    const entry = store.get(sessionId);
    if (!entry) return 0;

    const elapsed = Date.now() - entry.lastSentAt;
    const remaining = INTERVAL_MS - elapsed;
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  static clearSession(sessionId: string): void {
    store.delete(sessionId);
  }

  static getIntervalMs(): number {
    return INTERVAL_MS;
  }
}

/**
 * Middleware de rate limiting
 * Debe ir DESPUÉS de requireAuth en la cadena de middleware.
 */
export function chatRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.user?.sub;

  if (!userId) {
    res.status(500).json({ error: "Error interno de configuración del middleware" });
    return;
  }

  if (RateLimiter.canSend(userId)) {
    // Registramos el envío al continuar
    RateLimiter.recordSend(userId);
    next();
  } else {
    // Límite alcanzado
    const retryAfterSec = RateLimiter.secondsUntilNext(userId);

    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      error: "Demasiadas solicitudes",
      message: `Reintenta en ${retryAfterSec}s.`,
      retryAfterSeconds: retryAfterSec,
    });
  }
}