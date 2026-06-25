import dotenv from "dotenv";
import path from "path";
import { logger } from "../utils/logger";
const envPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: envPath });

interface EnvConfig {
  PORT: number;
  MASTER_KEY: string;
  JWT_SECRET: string;
  KICK_API_URL: string;
  NODE_ENV: string;
  JWT_EXPIRES_IN: string;
  KICK_CLIENT_ID: string;
  KICK_CLIENT_SECRET: string;
  KICK_REDIRECT_URI: string;
  GEMINI_API_KEY: string;
  OPENROUTER_API_KEY: string;
}

function requireVar(label: string, value: string | undefined, minLen: number): string {
  if (!value || value.length < minLen) {
    throw new Error(`[env] ${label} requerida (mín ${minLen} caracteres)`);
  }
  return value;
}

function optionalVar(label: string, value: string | undefined): string {
  if (!value) {
    logger.warn("env", `${label} no definida`);
  }
  return value || "";
}

export const env: EnvConfig = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  MASTER_KEY: requireVar("MASTER_KEY", process.env.MASTER_KEY, 32),
  JWT_SECRET: requireVar("JWT_SECRET", process.env.JWT_SECRET, 16),
  KICK_API_URL: optionalVar("KICK_API_URL", process.env.KICK_API_URL),
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "24h",
  KICK_CLIENT_ID: requireVar("KICK_CLIENT_ID", process.env.KICK_CLIENT_ID, 1),
  KICK_CLIENT_SECRET: requireVar("KICK_CLIENT_SECRET", process.env.KICK_CLIENT_SECRET, 1),
  KICK_REDIRECT_URI: requireVar("KICK_REDIRECT_URI", process.env.KICK_REDIRECT_URI, 1),
  GEMINI_API_KEY: optionalVar("GEMINI_API_KEY", process.env.GEMINI_API_KEY),
  OPENROUTER_API_KEY: optionalVar("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY),
};
