/**
 * server-engine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point del servidor Express.
 * Fase 3: Modo "Envío Bajo Demanda" (Sin Scheduler interno)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";

import { env } from "./config/env";
import { loginUser, registerUser } from "./services/auth-manager";
import { loadBearers } from "./services/security";
import { requireAuth } from "./middleware/jwt.middleware";
import { requireAdmin } from "./middleware/admin.middleware";
import {
  adminCreateBot,
  adminListBots,
  adminCreateUser,
  adminListUsers,
  adminAssignBot,
  adminGetAssignments,
} from "./controllers/admin.controller";
import { RateLimiter } from "./middleware/rate-limiter";
import { handleChatSend, handleListMyBots } from "./controllers/chat.controller";
import { validate, LoginSchema, RegisterSchema, LoginInput, RegisterInput } from "./utils/validators";
import { requestLogger, metricsRouter, recordMessage } from "./telemetry";
import type { GenericResponse } from "./types/response";
import { initDatabase } from "./models/database";

const app = express();

app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false }));
app.disable("x-powered-by");

// ─── Static files (Web UI) ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Telemetry ─────────────────────────────────────────────────────────────────
app.use(requestLogger);

// ─── Limiters ─────────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use(globalLimiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// ─── Rutas de Autenticación ───────────────────────────────────────────────────

app.post("/auth/register", authLimiter, async (req: Request, res: Response) => {
  const v = validate(RegisterSchema, req.body);
  if (!v.success) {
    return res.status(400).json({ success: false, error: "Datos inválidos", fields: (v as any).errors } as GenericResponse);
  }
  
  try {
    const data = v.data as RegisterInput;
    const user = await registerUser(data.username, data.password);
    res.status(201).json({ success: true, message: "Usuario registrado", username: user.username } as GenericResponse);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/auth/login", authLimiter, async (req: Request, res: Response) => {
  const v = validate(LoginSchema, req.body);
  if (!v.success) {
    return res.status(400).json({ success: false, error: "Datos inválidos", fields: (v as any).errors } as GenericResponse);
  }

  try {
    const data = v.data as LoginInput;
    const result = await loginUser(data.username, data.password, req.ip);
    res.status(200).json({ success: true, token: result.token, expiresAt: result.expiresAt, tokenType: "Bearer" } as GenericResponse);
  } catch (err) {
    res.status(401).json({ error: "No autorizado", message: "Credenciales inválidas" });
  }
});

// ─── Rutas Protegidas (Fase 3: Envío Bajo Demanda) ─────────────────────────────

/**
 * POST /chat/send
 * El servidor NO tiene scheduler. Solo reacciona a esta petición.
 * Protegido por: 1. JWT, 2. RateLimiter centralizado.
 */
app.post("/chat/send", requireAuth, async (req: Request, res: Response) => {
  // sessionId viene en el body enviado por el cliente (BridgeClient)
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "sessionId es requerido." });
  }

  // Verificar Rate Limiter central
  if (!RateLimiter.canSend(sessionId)) {
    const wait = RateLimiter.secondsUntilNext(sessionId);
    return res.status(429).json({ 
      error: "Rate limit alcanzado.", 
      retryAfterSeconds: wait 
    });
  }

  // Ejecutar envío
  await handleChatSend(req, res);
  
  // Si handleChatSend fue exitoso (200), marcamos el envío
  if (res.statusCode === 200) {
    RateLimiter.recordSend(sessionId);
    recordMessage();
  }
});

/**
 * GET /me/bots
 * Lista los bots asignados al usuario autenticado.
 */
app.get("/me/bots", requireAuth, handleListMyBots);

/**
 * DELETE /session/:sessionId
 * Endpoint para que el cliente Electron limpie su estado al cerrar.
 */
app.delete("/session/:sessionId", (req: Request, res: Response) => {
  RateLimiter.clearSession(req.params.sessionId);
  res.status(200).json({ success: true, message: "Sesión cerrada" });
});

// ─── Rutas de Administración (solo admin) ─────────────────────────────────────

app.post("/admin/bots",         requireAuth, requireAdmin, adminCreateBot);
app.get("/admin/bots",          requireAuth, requireAdmin, adminListBots);
app.post("/admin/users",        requireAuth, requireAdmin, adminCreateUser);
app.get("/admin/users",         requireAuth, requireAdmin, adminListUsers);
app.post("/admin/assign",       requireAuth, requireAdmin, adminAssignBot);
app.get("/admin/assignments/:userId", requireAuth, requireAdmin, adminGetAssignments);

// ─── Metrics Router ────────────────────────────────────────────────────────────
app.use(metricsRouter);

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", mode: "on-demand", timestamp: new Date().toISOString() });
});

// ─── Error Handlers ───────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => res.status(404).json({ error: "Ruta no encontrada" }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log("🗄️  Inicializando base de datos...");
  await initDatabase();

  console.log("🔐 Verificando bearers...");
  loadBearers();

  app.listen(env.PORT, () => {
    console.log(`\n🚀 StreamChat Bridge (Fase 3) en puerto ${env.PORT}`);
    console.log(`   Modo: On-Demand | Rate Limit: ${RateLimiter.getIntervalMs() / 1000}s\n`);
  });
}

bootstrap().catch((err) => {
  console.error("❌ Error fatal:", err);
  process.exit(1);
});