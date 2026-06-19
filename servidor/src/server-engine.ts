import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import path from "path";
import { env } from "./config/env";
import { loadBearers } from "./services/security";
import { requestLogger, metricsRouter } from "./telemetry";
import { initDatabase } from "./models/database";
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

app.use(cors({
  origin: process.env.NODE_ENV === "production" ? [env.KICK_API_URL].filter(Boolean) : "*",
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],  // modules require 'unsafe-inline' or nonce
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
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
app.get("/vods.html", requirePageAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "vods.html"));
});

app.get("/admin/clientes", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "clientes.html"));
});
app.get("/admin/proxies", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin", "proxies.html"));
});

// ─── Telemetry ───────────────────────────────────────────────────
app.use(requestLogger);

// ─── Rate Limiter global ─────────────────────────────────────────
const globalLimiter = rateLimit({ windowMs: 60_000, max: 120, skip: (req) => req.path.startsWith("/api/admin/") || req.path.startsWith("/me/") });
app.use(globalLimiter);

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

// ─── Health Check ────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", mode: "on-demand", timestamp: new Date().toISOString() });
});

// ─── Error Handlers ──────────────────────────────────────────────
app.use((_req: Request, res: Response) => res.status(404).json({ error: "Ruta no encontrada" }));
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(TAG, "Error no manejado", err.message, err.stack);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ─── Process handlers ────────────────────────────────────────────
process.on("unhandledRejection", (reason: any) => { logger.error(TAG, "Unhandled Rejection", reason); });
process.on("uncaughtException", (err) => { logger.error(TAG, "Uncaught Exception", err.message, err.stack); });

async function bootstrap(): Promise<void> {
  logger.info(TAG, "Inicializando base de datos...");
  await initDatabase();
  logger.info(TAG, "Verificando bearers...");
  try { loadBearers(); } catch { logger.warn(TAG, "Sin bearers.enc — solo bots OAuth disponibles"); }
  app.listen(env.PORT, () => {
    logger.info(TAG, "StreamChat Bridge en puerto " + env.PORT);
  });
}

bootstrap().catch((err: any) => {
  logger.error(TAG, "Error fatal", err.message);
  process.exit(1);
});
