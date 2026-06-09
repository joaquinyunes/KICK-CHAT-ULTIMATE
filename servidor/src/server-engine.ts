// server-engine.ts - Entry point Express mas rutas
/**
 * server-engine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point del servidor Express.
 * Configura middleware global, define rutas y arranca el proceso.
 *
 * ARQUITECTURA:
 *   POST /auth/register  → auth-manager (registro)
 *   POST /auth/login     → auth-manager (login + JWT)
 *   POST /chat/send      → requireAuth → chatRateLimiter → chat.controller
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import rateLimit from "express-rate-limit";

import { env }             from "./config/env";
import { loginUser, registerUser } from "./services/auth-manager";
import { loadBearers }     from "./services/security";
import { requireAuth }     from "./middleware/jwt.middleware";
import { chatRateLimiter } from "./middleware/rate-limiter";
import { handleChatSend }  from "./controllers/chat.controller";
import { validate, LoginSchema, RegisterSchema } from "./utils/validators";

const app = express();

// ─── Middleware Global ─────────────────────────────────────────────────────────

app.use(express.json({ limit: "16kb" })); // evitar payloads gigantes
app.use(express.urlencoded({ extended: false }));

// Ocultar información de tecnología
app.disable("x-powered-by");

// Rate limiting global (contra DoS / escaneo de endpoints)
const globalLimiter = rateLimit({
  windowMs:         60_000,   // 1 minuto
  max:              60,       // máx 60 peticiones/min por IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message: {
    error:   "Demasiadas solicitudes",
    message: "Por favor espera un momento antes de continuar.",
  },
});
app.use(globalLimiter);

// Rate limiting más estricto para endpoints de auth (contra brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max:      10,              // máx 10 intentos de login por IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    error:   "Demasiados intentos",
    message: "Cuenta bloqueada temporalmente. Intenta en 15 minutos.",
  },
});

// ─── Rutas de Autenticación ───────────────────────────────────────────────────

/**
 * POST /auth/register
 * Registra un nuevo usuario. En producción considera proteger este endpoint
 * con una clave de admin o deshabilitarlo una vez creados los usuarios.
 */
app.post(
  "/auth/register",
  authLimiter,
  async (req: Request, res: Response) => {
    const v = validate(RegisterSchema, req.body);
    if (!v.success) {
      res.status(400).json({ error: "Datos inválidos", fields: v.errors });
      return;
    }

    try {
      const user = await registerUser(v.data.username, v.data.password);
      res.status(201).json({
        message:  "Usuario registrado correctamente",
        username: user.username,
      });
    } catch (err) {
      const message = (err as Error).message;
      // Distinguir conflicto de nombre vs error interno
      if (message.includes("ya existe")) {
        res.status(409).json({ error: "Conflicto", message });
      } else {
        console.error("[server] Error en /auth/register:", err);
        res.status(500).json({ error: "Error interno del servidor" });
      }
    }
  }
);

/**
 * POST /auth/login
 * Valida credenciales y retorna el JWT de 24 horas.
 */
app.post(
  "/auth/login",
  authLimiter,
  async (req: Request, res: Response) => {
    const v = validate(LoginSchema, req.body);
    if (!v.success) {
      res.status(400).json({ error: "Datos inválidos", fields: v.errors });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress;

    try {
      const result = await loginUser(v.data.username, v.data.password, ip);
      res.status(200).json({
        token:     result.token,
        expiresAt: result.expiresAt,
        tokenType: "Bearer",
      });
    } catch (err) {
      // Mensaje genérico — no revelar si el usuario existe o no
      res.status(401).json({
        error:   "No autorizado",
        message: "Credenciales inválidas",
      });
    }
  }
);

// ─── Rutas Protegidas ─────────────────────────────────────────────────────────

/**
 * POST /chat/send
 * Envía un mensaje al chat de Kick.
 * Requiere JWT válido + respeta rate limit de 1 msg / 30s por usuario.
 */
app.post(
  "/chat/send",
  requireAuth,
  chatRateLimiter,
  handleChatSend
);

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

// ─── Error Handler Global ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Verificar que los bearers se pueden descifrar ANTES de aceptar tráfico
  console.log("🔐  Verificando archivo de bearers cifrado...");
  loadBearers(); // lanza si hay error — falla rápido

  app.listen(env.PORT, () => {
    console.log(`\n🚀  StreamChat Bridge corriendo en puerto ${env.PORT}`);
    console.log(`    Entorno: ${env.NODE_ENV}`);
    console.log(`    Endpoints:`);
    console.log(`      POST /auth/register`);
    console.log(`      POST /auth/login`);
    console.log(`      POST /chat/send  (🔒 JWT + Rate Limit)\n`);
  });
}

bootstrap().catch((err) => {
  console.error("❌  Error fatal al arrancar el servidor:", err);
  process.exit(1);
});