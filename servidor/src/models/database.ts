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
      is_active   INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Migración: agregar columna role en DBs existentes
  try { db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'client'"); } catch {}

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
      is_active        INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bot_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_id      INTEGER NOT NULL REFERENCES bots(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      assigned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(bot_id, user_id)
    )
  `);

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
