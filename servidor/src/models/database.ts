// models/database.ts - SQLite via sql.js (pure JS, no native compilation)
/**
 * models/database.ts
 * Configura y exporta la conexión SQLite usando sql.js.
 * Persiste en disco sincronizando el buffer.
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";

const DB_PATH = path.resolve(process.cwd(), "data", "streamchat.db");

let db: SqlJsDatabase;

// ─── Inicialización async ────────────────────────────────────────────────────

async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      password_hash TEXT  NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'client',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      is_active   INTEGER NOT NULL DEFAULT 1,
      link_url    TEXT,
      expires_at  INTEGER
    )
  `);

  try { db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'client'"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN link_url TEXT"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN expires_at INTEGER"); } catch {}

  // Sembrar admin por defecto si no existe
  const adminExists = db.exec("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
  if (adminExists.length === 0) {
    const adminHash = bcrypt.hashSync("admin123", 12);
    db.run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')", ["admin", adminHash]);
    console.log("[DB] Usuario admin creado (admin / admin123) — CAMBIA LA CONTRASEÑA");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      action      TEXT    NOT NULL,
      ip_address  TEXT,
      meta        TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_user_id
      ON activity_log(user_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
      ON activity_log(created_at)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bots (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_name         TEXT    NOT NULL UNIQUE,
      encrypted_bearer TEXT    NOT NULL,
      oauth_refresh_token TEXT,
      oauth_access_token  TEXT,
      oauth_token_expires_at INTEGER,
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  try { db.run("ALTER TABLE bots ADD COLUMN oauth_refresh_token TEXT"); } catch {}
  try { db.run("ALTER TABLE bots ADD COLUMN oauth_access_token TEXT"); } catch {}
  try { db.run("ALTER TABLE bots ADD COLUMN oauth_token_expires_at INTEGER"); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS bot_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id      INTEGER NOT NULL REFERENCES bots(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      assigned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(bot_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id          INTEGER REFERENCES bots(id),
      user_id         INTEGER REFERENCES users(id),
      channel         TEXT,
      message_preview TEXT,
      success         INTEGER NOT NULL DEFAULT 0,
      error_reason    TEXT,
      sent_at         INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_message_log_sent_at ON message_log(sent_at DESC)`);

  saveDb();
  return db;
}

// ─── Persistencia ────────────────────────────────────────────────────────────

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function saveDb(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (err) {
      console.error("[DB] Error al guardar:", err);
    }
  }, 200);
}

// ─── Wrapper para prepared statements tipo better-sqlite3 ────────────────────

interface StmtWrapper<TBind, TRow> {
  run: (params: TBind) => { changes: number; lastInsertRowid: number };
  get: (params?: any | any[]) => TRow | undefined;
  all: (params?: any | any[]) => TRow[];
}

function prepareStmt<TBind extends Record<string, any>, TRow = any>(
  sql: string
): StmtWrapper<TBind, TRow> {
  return {
    run(params: TBind): { changes: number; lastInsertRowid: number } {
      const stmt = db.prepare(sql);
      const values = Object.values(params);
      stmt.run(values);
      stmt.free();
      saveDb();
      const idStmt = db.prepare("SELECT last_insert_rowid() as id");
      const lastInsertRowid = idStmt.step() ? (idStmt.getAsObject() as any).id : 0;
      idStmt.free();
      return { changes: 1, lastInsertRowid };
    },

    get(params?: any | any[]): TRow | undefined {
      const stmt = db.prepare(sql);
      const bindParams = Array.isArray(params) ? params : (params !== undefined ? [params] : []);
      if (bindParams.length > 0) stmt.bind(bindParams);
      const result = stmt.step() ? (stmt.getAsObject() as TRow) : undefined;
      stmt.free();
      return result;
    },

    all(params?: any | any[]): TRow[] {
      const stmt = db.prepare(sql);
      const bindParams = Array.isArray(params) ? params : (params !== undefined ? [params] : []);
      if (bindParams.length > 0) stmt.bind(bindParams);
      const rows: TRow[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as TRow);
      }
      stmt.free();
      return rows;
    },
  };
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at: number;
  is_active: number;
  link_url: string | null;
  expires_at: number | null;
}

export interface MessageLogRow {
  id: number;
  bot_id: number | null;
  user_id: number | null;
  channel: string | null;
  message_preview: string | null;
  success: number;
  error_reason: string | null;
  sent_at: number;
}

export interface ActivityLogRow {
  id: number;
  user_id: number;
  action: string;
  ip_address: string | null;
  meta: string | null;
  created_at: number;
}

export interface BotRow {
  id: number;
  bot_name: string;
  encrypted_bearer: string;
  oauth_refresh_token: string | null;
  oauth_access_token: string | null;
  oauth_token_expires_at: number | null;
  is_active: number;
  created_at: number;
}

export interface BotAssignmentRow {
  id: number;
  bot_id: number;
  user_id: number;
  assigned_at: number;
}

// ─── Statements preparados ────────────────────────────────────────────────────

export const stmts = {
  insertUser: prepareStmt<{ username: string; password_hash: string }, UserRow>(
    `INSERT INTO users (username, password_hash) VALUES (?, ?)`
  ),

  findUserByUsername: prepareStmt<[string], UserRow>(
    `SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1`
  ),

  findUserById: prepareStmt<[number], UserRow>(
    `SELECT * FROM users WHERE id = ? LIMIT 1`
  ),

  insertLog: prepareStmt<{
    user_id: number;
    action: string;
    ip_address: string | null;
    meta: string | null;
  }>(
    `INSERT INTO activity_log (user_id, action, ip_address, meta) VALUES (?, ?, ?, ?)`
  ),

  insertBot: prepareStmt<{ bot_name: string; encrypted_bearer: string }, BotRow>(
    `INSERT INTO bots (bot_name, encrypted_bearer) VALUES (?, ?)`
  ),

  findBotByName: prepareStmt<[string], BotRow>(
    `SELECT * FROM bots WHERE bot_name = ? LIMIT 1`
  ),

  findBotById: prepareStmt<[number], BotRow>(
    `SELECT * FROM bots WHERE id = ? LIMIT 1`
  ),

  listActiveBots: prepareStmt<never, BotRow>(
    `SELECT * FROM bots WHERE is_active = 1 ORDER BY bot_name ASC`
  ),

  assignBotToUser: prepareStmt<{ bot_id: number; user_id: number }, BotAssignmentRow>(
    `INSERT OR IGNORE INTO bot_assignments (bot_id, user_id) VALUES (?, ?)`
  ),

  listBotsForUser: prepareStmt<[number], BotRow>(
    `SELECT b.* FROM bots b
     INNER JOIN bot_assignments ba ON ba.bot_id = b.id
     WHERE ba.user_id = ? AND b.is_active = 1
     ORDER BY b.bot_name ASC`
  ),

  // ─── Admin ──────────────────────────────────────────────────────────────────

  listAllUsers: prepareStmt<never, UserRow>(
    `SELECT * FROM users ORDER BY username ASC`
  ),

  listAllBots: prepareStmt<never, BotRow>(
    `SELECT * FROM bots ORDER BY bot_name ASC`
  ),

  findUserByUsernameExact: prepareStmt<[string], UserRow>(
    `SELECT * FROM users WHERE username = ? LIMIT 1`
  ),

  insertUserWithRole: prepareStmt<{ username: string; password_hash: string; role: string }, UserRow>(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`
  ),

  insertUserFull: prepareStmt<{ username: string; password_hash: string; role: string; link_url: string | null; expires_at: number | null }, UserRow>(
    `INSERT INTO users (username, password_hash, role, link_url, expires_at) VALUES (?, ?, ?, ?, ?)`
  ),

  updateUser: prepareStmt<{ q_link: string | null; q_expires: number | null; q_active: number; q_id: number }, any>(
    `UPDATE users SET link_url = ?, expires_at = ?, is_active = ? WHERE id = ?`
  ),

  deleteUser: prepareStmt<{ q_id: number }, any>(
    `DELETE FROM users WHERE id = ? AND role != 'admin'`
  ),

  insertMessageLog: prepareStmt<{ bot_id: number | null; user_id: number | null; channel: string | null; message_preview: string | null; success: number; error_reason: string | null }, MessageLogRow>(
    `INSERT INTO message_log (bot_id, user_id, channel, message_preview, success, error_reason) VALUES (?, ?, ?, ?, ?, ?)`
  ),

  getRecentMessages: prepareStmt<[number], MessageLogRow & { bot_name?: string }>(
    `SELECT ml.*, b.bot_name FROM message_log ml LEFT JOIN bots b ON b.id = ml.bot_id ORDER BY ml.sent_at DESC LIMIT ?`
  ),

  updateBotOAuthTokens: prepareStmt<{ q_refresh: string | null; q_access: string | null; q_expires: number | null; q_id: number }, any>(
    `UPDATE bots SET oauth_refresh_token = ?, oauth_access_token = ?, oauth_token_expires_at = ? WHERE id = ?`
  ),

  unassignBotFromUser: prepareStmt<{ q_bot_id: number; q_user_id: number }, any>(
    `DELETE FROM bot_assignments WHERE bot_id = ? AND user_id = ?`
  ),
};

// ─── Init y export ────────────────────────────────────────────────────────────

let initPromise: Promise<SqlJsDatabase> | null = null;

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

export async function initDatabase(): Promise<SqlJsDatabase> {
  if (!initPromise) {
    initPromise = initDb();
  }
  return initPromise;
}

export default { initDatabase, getDb, stmts };
