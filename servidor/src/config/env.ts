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
}

export const env: EnvConfig = {
  PORT: parseInt(process.env.PORT || "3000", 10),
  MASTER_KEY: process.env.MASTER_KEY || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  KICK_API_URL: process.env.KICK_API_URL || "https://kick.com/api/v2/messages/send",
  NODE_ENV: process.env.NODE_ENV || "development",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "24h",
};
