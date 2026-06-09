// middleware/rate-limiter.ts - Rate limiting 1 mensaje por 30s por usuario
/**
 * middleware/rate-limiter.ts
 * Rate limiting por usuario autenticado: 1 mensaje cada 30 segundos.
 *
 * Se usa un Map en memoria (válido para una sola instancia).
 * Para múltiples instancias, reemplazar con Redis.
 */

import type { Request, Response, NextFunction } from "express";

const WINDOW_MS    = 30_000; // 30 segundos
const MAX_REQUESTS = 1;      // máximo 1 mensaje por ventana

interface RateLimitEntry {
  count:      number;
  windowStart: number;
}

// Store en memoria: { userId → entry }
const store = new Map<string, RateLimitEntry>();

// Limpieza periódica para evitar memory leaks en stores largos
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 60_000); // limpiar cada minuto

/**
 * Middleware de rate limiting POR USUARIO (usa req.user.sub inyectado por requireAuth).
 * Debe ir DESPUÉS de requireAuth en la cadena de middleware.
 */
export function chatRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.user?.sub;

  if (!userId) {
    // requireAuth no se ejecutó primero — error de configuración
    res.status(500).json({ error: "Error interno de configuración del middleware" });
    return;
  }

  const now   = Date.now();
  const entry = store.get(userId);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Primera petición o ventana expirada → reiniciar
    store.set(userId, { count: 1, windowStart: now });
    next();
    return;
  }

  if (entry.count < MAX_REQUESTS) {
    entry.count++;
    next();
    return;
  }

  // Límite alcanzado
  const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);

  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json({
    error:   "Demasiadas solicitudes",
    message: `Puedes enviar 1 mensaje cada 30 segundos. Reintenta en ${retryAfterSec}s.`,
    retryAfterSeconds: retryAfterSec,
  });
}