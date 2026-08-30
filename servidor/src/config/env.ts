import dotenv from "dotenv";
import path from "path";
import { z } from "zod";
import { logger } from "../utils/logger";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Único punto de verdad para la configuración por entorno.
 * Valida TODAS las variables al arrancar y falla rápido listando
 * todos los errores juntos (no de a uno).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),

  // Clave maestra AES-256-GCM. Recomendado: 64 hex chars (32 bytes).
  // Se acepta >=32 por compatibilidad con claves utf-8 previas.
  MASTER_KEY: z.string().min(32, "MASTER_KEY debe tener al menos 32 caracteres (ideal: 64 hex)"),

  JWT_SECRET: z.string().min(16, "JWT_SECRET debe tener al menos 16 caracteres (ideal: 32+)"),
  JWT_EXPIRES_IN: z.string().default("24h"),

  // CORS en producción
  APP_URL: z.string().url().optional(),

  // Endpoint de métricas
  ADMIN_SECRET: z.string().min(16).optional(),

  // Kick OAuth oficial (dev.kick.com)
  KICK_CLIENT_ID: z.string().min(1, "KICK_CLIENT_ID requerido"),
  KICK_CLIENT_SECRET: z.string().min(1, "KICK_CLIENT_SECRET requerido"),
  KICK_REDIRECT_URI: z.string().url("KICK_REDIRECT_URI debe ser una URL válida"),

  // Generación de chat simulado
  OPENROUTER_API_KEY: z.string().optional().default(""),

  // Workers Python (VOD viewer / senders)
  PYTHON_PATH: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  · ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  logger.error("env", `Configuración inválida:\n${issues}`);
  throw new Error("[env] Variables de entorno inválidas o faltantes. Revisá .env.example");
}

export const env = parsed.data;
export type Env = typeof env;

if (!/^[0-9a-fA-F]{64}$/.test(env.MASTER_KEY)) {
  logger.warn("env", "MASTER_KEY no es 64 hex — usando modo compatibilidad. Migrá a `openssl rand -hex 32`.");
}
if (env.JWT_SECRET.length < 32) {
  logger.warn("env", "JWT_SECRET < 32 caracteres — subilo para HS256 robusto.");
}
if (!env.ADMIN_SECRET) {
  logger.warn("env", "ADMIN_SECRET no definido — el endpoint /metrics queda bloqueado.");
}
if (!env.OPENROUTER_API_KEY) {
  logger.warn("env", "OPENROUTER_API_KEY no definido — el simulador usa el generador local.");
}
