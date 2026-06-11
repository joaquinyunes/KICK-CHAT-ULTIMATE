// config/env.ts - Loader y validacion de variables de entorno

import dotenv from "dotenv";
dotenv.config();

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
}

export const env: EnvConfig = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  MASTER_KEY: process.env.MASTER_KEY || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  KICK_API_URL: process.env.KICK_API_URL || "",
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "24h",
  KICK_CLIENT_ID: process.env.KICK_CLIENT_ID || "",
  KICK_CLIENT_SECRET: process.env.KICK_CLIENT_SECRET || "",
  KICK_REDIRECT_URI: process.env.KICK_REDIRECT_URI || "",
};
