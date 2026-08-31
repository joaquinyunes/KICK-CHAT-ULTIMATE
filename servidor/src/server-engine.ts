import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import path from "path";
import { env } from "./config/env";
import { loadBearers } from "./services/security";
import { startKcIngest } from "./services/kc-ingest.service";
import { startKcPipeline, killPipelineSync } from "./services/kc-supervisor.service";
import { requestLogger, metricsRouter } from "./telemetry";
import { initDatabase, flushDb, getDb } from "./models/database";
import { logger } from "./utils/logger";

const TAG = "server";

import authRoutes from "./routes/auth.routes";
import chatRoutes from "./routes/chat.routes";
import oauthRoutes from "./routes/oauth.routes";
import adminDashboardRoutes from "./routes/admin-dashboard.routes";
import adminBotsRoutes from "./routes/admin-bots.routes";
import adminClientesRoutes from "./routes/admin-clientes.routes";
import adminProxiesRoutes from "./routes/admin-proxies.routes";
import clientVodsRoutes from "./routes/client-vods.routes";
import simulatorRoutes from "./routes/simulator.routes";
import actionsRoutes from "./routes/actions.routes";
import { requirePageAuth } from "./middleware/auth-page.middleware";

const app = express();

// Detrás de un reverse proxy (nginx, Fly, Railway…): confiar en 1 hop
// para que req.ip / rate-limit / audit log usen la IP real del cliente.
app.set("trust proxy", 1);

app.use(cors({
  // "*" + credentials es inválido; en dev reflejamos el origin.
  origin: env.NODE_ENV === "production" ? (env.APP_URL ?? false) : true,
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // modules require 'unsafe-inline' or nonce
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false }));
app.disable("x-powered-by");

app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Admin page routes — protegidas con cookie JWT ──────────────
app.use("/admin", requirePageAuth);
app.get("/admin", (req: Request, res: Response) => {
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(`/admin/dashboard${query}`);
});
app.get("/admin/dashboard", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "dashboard.html"));
});
app.get("/admin/bots", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "bots.html"));
});
app.get("/vods.html", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "vods.html"));
});
app.get("/vods", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "vods.html"));
});
app.get("/chat.html", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "chat.html"));
});
app.get("/chat", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "chat.html"));
});
app.get("/kc", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "kc.html"));
});

app.get("/admin/clientes", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "clientes.html"));
});
app.get("/admin/proxies", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "proxies.html"));
});
// ─── Telemetry ───────────────────────────────────────────────────
app.use(requestLogger);

// ─── Rate Limiters ───────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith("/me/"),
});
app.use(globalLimiter);

// Límite dedicado (más laxo que el global en ráfaga, pero acotado) para el panel admin.
const adminLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use("/api/admin", adminLimiter);

// ─── Routers ─────────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use(chatRoutes);
app.use(oauthRoutes);
app.use(adminDashboardRoutes);
app.use(adminBotsRoutes);
app.use(adminClientesRoutes);
app.use(adminProxiesRoutes);
app.use(clientVodsRoutes);
app.use(simulatorRoutes);
app.use(actionsRoutes);

// ─── Metrics ─────────────────────────────────────────────────────
app.use(metricsRouter);

// ─── Health / Readiness ──────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", mode: "on-demand", timestamp: new Date().toISOString() });
});

let ready = false;
export function markReady(): void { ready = true; }
app.get("/ready", (_req: Request, res: Response) => {
  if (!ready) { res.status(503).json({ status: "starting" }); return; }
  try {
    getDb().exec("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "db-unavailable" });
  }
});

// ─── Error Handlers ──────────────────────────────────────────────
app.use((_req: Request, res: Response) => res.status(404).json({ error: "Ruta no encontrada" }));
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(TAG, "Error no manejado", err.message, err.stack);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ─── Process handlers ────────────────────────────────────────────
process.on("unhandledRejection", (reason: any) => { logger.error(TAG, "Unhandled Rejection", reason); });
process.on("uncaughtException", (err) => { logger.error(TAG, "Uncaught Exception", err.message, err.stack); process.exit(1); });

let server: ReturnType<typeof app.listen> | null = null;

let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  logger.info(TAG, `Recibido ${signal} — cerrando servidor...`);
  try { killPipelineSync(); } catch { /* noop */ }
  const finish = (code: number) => {
    try { flushDb(); } catch (e) { logger.error(TAG, "flushDb falló en shutdown", String(e)); }
    process.exit(code);
  };
  if (server) {
    server.close(() => {
      logger.info(TAG, "Servidor HTTP cerrado");
      finish(0);
    });
    setTimeout(() => {
      logger.error(TAG, "Fallo shutdown graceful — forzando salida");
      finish(1);
    }, 10000).unref();
  } else {
    finish(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

async function bootstrap(): Promise<void> {
  logger.info(TAG, "Inicializando base de datos...");
  await initDatabase();
  logger.info(TAG, "Verificando bearers...");
  try { loadBearers(); } catch { logger.warn(TAG, "Sin bearers.enc — solo bots OAuth disponibles"); }
  server = app.listen(env.PORT, () => {
    markReady();
    logger.info(TAG, "StreamChat Bridge en puerto " + env.PORT);
  });
  try { startKcPipeline(); } catch (e: any) { logger.warn(TAG, "kc-pipeline no arrancó: " + e.message); }
  try { startKcIngest(); } catch (e: any) { logger.warn(TAG, "kc-ingest no arrancó: " + e.message); }
}

bootstrap().catch((err: any) => {
  logger.error(TAG, "Error fatal", err.message);
  process.exit(1);
});
