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
  try { db.run("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[\"chat\",\"simulator\",\"vods\"]'"); } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN hourly_view_limit INTEGER NOT NULL DEFAULT 50"); } catch {}

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
  try { db.run("ALTER TABLE bots ADD COLUMN cookies TEXT DEFAULT ''"); } catch {}

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

  // ─── Stream Simulator tables ────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS sim_sessions (
      id              TEXT PRIMARY KEY,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      stream_context  TEXT NOT NULL,
      total_mensajes  INTEGER DEFAULT 0,
      ultimo_bloque   INTEGER,
      temas_activos   TEXT,
      apuestas        TEXT,
      usuarios_vistos TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sim_mensajes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL REFERENCES sim_sessions(id),
      bloque_numero   INTEGER NOT NULL,
      posicion        INTEGER NOT NULL,
      user_name       TEXT NOT NULL,
      message         TEXT NOT NULL,
      tipo            TEXT NOT NULL,
      timestamp_gen   INTEGER NOT NULL DEFAULT (unixepoch()),
      noticias_usadas TEXT
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_sim_mensajes_session ON sim_mensajes(session_id, bloque_numero)`);

  // ─── Triggers / Actions tables ──────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS triggers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      source      TEXT NOT NULL,
      event       TEXT NOT NULL,
      filters     TEXT,
      action_ids  TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS actions (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS action_steps (
      id          TEXT PRIMARY KEY,
      action_id   TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      order_num   INTEGER NOT NULL DEFAULT 0,
      params      TEXT NOT NULL DEFAULT '{}',
      enabled     INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_action_steps_action_id ON action_steps(action_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS sim_noticias_cache (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL REFERENCES sim_sessions(id),
      query_usada     TEXT NOT NULL,
      resultado       TEXT NOT NULL,
      buscado_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      usado_en_bloque INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sim_usuarios (
      username        TEXT PRIMARY KEY,
      personalidad    TEXT NOT NULL,
      veces_aparecio  INTEGER DEFAULT 0,
      ultima_aparicion INTEGER DEFAULT (unixepoch()),
      memoria         TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    INTEGER NOT NULL REFERENCES users(id),
      action      TEXT    NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      details     TEXT,
      ip_address  TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC)`);

  // ─── Proxies table ────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS proxies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      host        TEXT    NOT NULL,
      port        INTEGER NOT NULL,
      username    TEXT    NOT NULL,
      password    TEXT    NOT NULL,
      protocol    TEXT    NOT NULL DEFAULT 'http',
      is_active   INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // ─── Client VODs table ───────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS client_vods (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      url         TEXT    NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'vod',
      channel     TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      views_count INTEGER NOT NULL DEFAULT 0,
      added_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // ─── View log table ──────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS view_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      vod_id      INTEGER REFERENCES client_vods(id),
      proxy_id    INTEGER REFERENCES proxies(id),
      success     INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // ─── Message Pools table ──────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS message_pools (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      messages    TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
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
  run: (params: TBind | any[]) => { changes: number; lastInsertRowid: number };
  get: (params?: any | any[]) => TRow | undefined;
  all: (params?: any | any[]) => TRow[];
}

function prepareStmt<TBind, TRow = any>(
  sql: string
): StmtWrapper<TBind, TRow> {
  return {
    run(params: TBind | any[]): { changes: number; lastInsertRowid: number } {
      const stmt = db.prepare(sql);
      const values = Array.isArray(params) ? params : Object.values(params);
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
  permissions?: string;
  hourly_view_limit?: number;
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
  cookies: string | null;
  is_active: number;
  created_at: number;
}

export interface BotAssignmentRow {
  id: number;
  bot_id: number;
  user_id: number;
  assigned_at: number;
}

export interface ProxyRow {
  id: number;
  host: string;
  port: number;
  username: string;
  password: string;
  protocol: string;
  is_active: number;
  last_used_at: number | null;
  created_at: number;
}

export interface ClientVodRow {
  id: number;
  user_id: number;
  url: string;
  type: string;
  channel: string | null;
  is_active: number;
  views_count: number;
  added_at: number;
}

export interface ViewLogRow {
  id: number;
  user_id: number;
  vod_id: number | null;
  proxy_id: number | null;
  success: number;
  error: string | null;
  created_at: number;
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

  updateBotCookies: prepareStmt<{ q_cookies: string | null; q_id: number }, any>(
    `UPDATE bots SET cookies = ? WHERE id = ?`
  ),

  updateBotBearer: prepareStmt<{ q_bearer: string; q_id: number }, any>(
    `UPDATE bots SET encrypted_bearer = ? WHERE id = ?`
  ),

  deleteBot: prepareStmt<{ q_id: number }, any>(
    `DELETE FROM bots WHERE id = ?`
  ),

  // ─── Triggers / Actions ────────────────────────────────────────────────────

  insertTrigger: prepareStmt<{ id: string; name: string; enabled: number; source: string; event: string; filters: string | null; action_ids: string; created_at: number }, any>(
    `INSERT INTO triggers (id, name, enabled, source, event, filters, action_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),

  listTriggers: prepareStmt<never, any>(
    `SELECT * FROM triggers ORDER BY name ASC`
  ),

  updateTrigger: prepareStmt<{ name: string; enabled: number; source: string; event: string; filters: string | null; action_ids: string; id: string }, any>(
    `UPDATE triggers SET name=COALESCE(?, name), enabled=COALESCE(?, enabled), source=COALESCE(?, source), event=COALESCE(?, event), filters=COALESCE(?, filters), action_ids=COALESCE(?, action_ids) WHERE id=?`
  ),

  deleteTrigger: prepareStmt<{ id: string }, any>(
    `DELETE FROM triggers WHERE id = ?`
  ),

  insertAction: prepareStmt<{ id: string; name: string; enabled: number; created_at: number }, any>(
    `INSERT INTO actions (id, name, enabled, created_at) VALUES (?, ?, ?, ?)`
  ),

  listActions: prepareStmt<never, any>(
    `SELECT * FROM actions ORDER BY name ASC`
  ),

  findAction: prepareStmt<[string], any>(
    `SELECT * FROM actions WHERE id = ? LIMIT 1`
  ),

  deleteAction: prepareStmt<{ id: string }, any>(
    `DELETE FROM actions WHERE id = ?`
  ),

  insertStep: prepareStmt<{ id: string; action_id: string; type: string; order: number; params: string; enabled: number }, any>(
    `INSERT INTO action_steps (id, action_id, type, order_num, params, enabled) VALUES (?, ?, ?, ?, ?, ?)`
  ),

  listStepsForAction: prepareStmt<[string], any>(
    `SELECT * FROM action_steps WHERE action_id = ? ORDER BY order_num ASC`
  ),

  deleteStepsForAction: prepareStmt<{ action_id: string }, any>(
    `DELETE FROM action_steps WHERE action_id = ?`
  ),

  insertAuditLog: prepareStmt<{ admin_id: number; action: string; target_type: string | null; target_id: string | null; details: string | null; ip: string | null }, any>(
    `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)`
  ),

  // ─── Proxies ──────────────────────────────────────────────────────────────────
  insertProxy: prepareStmt<{ host: string; port: number; username: string; password: string; protocol: string; is_active: number }, ProxyRow>(
    `INSERT INTO proxies (host, port, username, password, protocol, is_active) VALUES (?, ?, ?, ?, ?, ?)`
  ),

  listProxies: prepareStmt<never, ProxyRow>(
    `SELECT * FROM proxies ORDER BY is_active DESC, created_at ASC`
  ),

  findProxyById: prepareStmt<[number], ProxyRow>(
    `SELECT * FROM proxies WHERE id = ? LIMIT 1`
  ),

  updateProxy: prepareStmt<{ host: string; port: number; username: string; password: string; protocol: string; is_active: number; id: number }, any>(
    `UPDATE proxies SET host=COALESCE(?,host), port=COALESCE(?,port), username=COALESCE(?,username), password=COALESCE(?,password), protocol=COALESCE(?,protocol), is_active=COALESCE(?,is_active) WHERE id=?`
  ),

  deleteProxy: prepareStmt<{ id: number }, any>(
    `DELETE FROM proxies WHERE id = ?`
  ),

  getRandomActiveProxy: prepareStmt<never, ProxyRow>(
    `SELECT * FROM proxies WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1`
  ),

  // ─── Client VODs ────────────────────────────────────────────────────────────
  insertClientVod: prepareStmt<{ user_id: number; url: string; type: string; channel: string | null }, ClientVodRow>(
    `INSERT INTO client_vods (user_id, url, type, channel) VALUES (?, ?, ?, ?)`
  ),

  listClientVods: prepareStmt<[number], ClientVodRow>(
    `SELECT * FROM client_vods WHERE user_id = ? ORDER BY added_at DESC`
  ),

  listActiveClientVods: prepareStmt<[number], ClientVodRow>(
    `SELECT * FROM client_vods WHERE user_id = ? AND is_active = 1 ORDER BY added_at DESC`
  ),

  findClientVodById: prepareStmt<[number], ClientVodRow>(
    `SELECT * FROM client_vods WHERE id = ? LIMIT 1`
  ),

  deleteClientVod: prepareStmt<{ id: number; user_id: number }, any>(
    `DELETE FROM client_vods WHERE id = ? AND user_id = ?`
  ),

  incrementVodViews: prepareStmt<{ id: number }, any>(
    `UPDATE client_vods SET views_count = views_count + 1 WHERE id = ?`
  ),

  // ─── View log ──────────────────────────────────────────────────────────────
  insertViewLog: prepareStmt<{ user_id: number; vod_id: number | null; proxy_id: number | null; success: number; error: string | null }, ViewLogRow>(
    `INSERT INTO view_log (user_id, vod_id, proxy_id, success, error) VALUES (?, ?, ?, ?, ?)`
  ),

  countViewsInLastHour: prepareStmt<[number], { cnt: number }>(
    `SELECT COUNT(*) as cnt FROM view_log WHERE user_id = ? AND created_at > (unixepoch() - 3600)`
  ),

  getViewStats: prepareStmt<[number], any>(
    `SELECT
       COUNT(*) as total_views,
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
       SUM(CASE WHEN created_at > (unixepoch() - 3600) THEN 1 ELSE 0 END) as last_hour
     FROM view_log WHERE user_id = ?`
  ),

  // ─── Message Pools ─────────────────────────────────────────────────────────
  insertPool: prepareStmt<{ name: string; messages: string }, any>(
    `INSERT INTO message_pools (name, messages) VALUES (?, ?)`
  ),
  listPools: prepareStmt<never, { id: number; name: string; messages: string; created_at: number }>(
    `SELECT * FROM message_pools ORDER BY name ASC`
  ),
  findPoolById: prepareStmt<[number], { id: number; name: string; messages: string; created_at: number }>(
    `SELECT * FROM message_pools WHERE id = ? LIMIT 1`
  ),
  deletePool: prepareStmt<[number], any>(
    `DELETE FROM message_pools WHERE id = ?`
  ),

  // ─── Permissions ───────────────────────────────────────────────────────────
  updateUserPermissions: prepareStmt<{ permissions: string; id: number }, any>(
    `UPDATE users SET permissions = ? WHERE id = ?`
  ),

  updateUserHourlyViewLimit: prepareStmt<{ hourly_view_limit: number; id: number }, any>(
    `UPDATE users SET hourly_view_limit = ? WHERE id = ?`
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
