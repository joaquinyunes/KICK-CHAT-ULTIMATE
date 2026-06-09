// models/database.ts - SQLite via better-sqlite3
/**
 * models/database.ts
 * Configura y exporta la conexión SQLite.
 * Crea las tablas si no existen (users + activity_log).
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "data", "streamchat.db");

// Asegurar que el directorio existe
import fs from "fs";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH, {
  // Verbose solo en desarrollo
  verbose: process.env.NODE_ENV === "development"
    ? (msg) => console.log(`[SQLite] ${msg}`)
    : undefined,
});

// Habilitar WAL mode para mejor concurrencia
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Esquema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE,
    password_hash TEXT  NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    is_active   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    action      TEXT    NOT NULL,           -- 'login' | 'chat_send' | 'login_failed'
    ip_address  TEXT,
    meta        TEXT,                       -- JSON libre para datos extra
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_activity_log_user_id
    ON activity_log(user_id);

  CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
    ON activity_log(created_at);
`);

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: number;
  is_active: number;
}

export interface ActivityLogRow {
  id: number;
  user_id: number;
  action: string;
  ip_address: string | null;
  meta: string | null;
  created_at: number;
}

// ─── Statements preparados (reutilizables, más eficientes) ────────────────────

export const stmts = {
  // Users
  insertUser: db.prepare<{ username: string; password_hash: string }>(
    `INSERT INTO users (username, password_hash) VALUES (@username, @password_hash)`
  ),
  findUserByUsername: db.prepare<[string], UserRow>(
    `SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1`
  ),
  findUserById: db.prepare<[number], UserRow>(
    `SELECT * FROM users WHERE id = ? LIMIT 1`
  ),

  // Activity log
  insertLog: db.prepare<{
    user_id: number;
    action: string;
    ip_address: string | null;
    meta: string | null;
  }>(
    `INSERT INTO activity_log (user_id, action, ip_address, meta)
     VALUES (@user_id, @action, @ip_address, @meta)`
  ),
};

export default db;