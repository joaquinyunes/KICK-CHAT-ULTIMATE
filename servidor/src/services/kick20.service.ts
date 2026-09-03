import crypto from "crypto";
import fs from "fs";
import path from "path";
import { encryptToHex, decryptFromHex } from "./security";
import { logger } from "../utils/logger";

/**
 * Módulo "kick20" — flujo OAuth 2.1 (PKCE) contra la API pública oficial de Kick
 * (id.kick.com + api.kick.com/public/v1). Aislado del resto: usa su propia app
 * (client_id/secret) y su propio archivo de credenciales. Soporta MÚLTIPLES
 * cuentas conectadas; al enviar rota entre ellas (round-robin). Envía como
 * usuario (`type: "user"`) al chat resuelto por slug de canal.
 */

const TAG = "kick20";
const STORE_PATH = path.resolve(process.cwd(), "data", "kick20.json");

const AUTH_URL = "https://id.kick.com/oauth/authorize";
const TOKEN_URL = "https://id.kick.com/oauth/token";
const API_CHAT_URL = "https://api.kick.com/public/v1/chat";
const API_CHANNELS_URL = "https://api.kick.com/public/v1/channels";
const API_USERS_URL = "https://api.kick.com/public/v1/users";
const SCOPES = "user:read channel:read chat:write";
const USER_AGENT = "StreamChatBridge-kick20/1.0";

export const DEFAULT_REDIRECT_URI = "http://localhost:3000/auth/kick/callback";

interface Account {
  username: string;
  access_enc: string;
  refresh_enc: string;
  expires_at: number; // epoch segundos
  scope: string;
  added_at: number;
}

interface Store {
  client_id: string;
  client_secret_enc: string;
  redirect_uri: string;
  accounts: Account[];
  // legacy — se migra a accounts[] al leer
  tokens?: { access_enc: string; refresh_enc: string; expires_at: number; scope: string; username: string | null };
}

// ─── Persistencia ────────────────────────────────────────────────────────────

function readStore(): Store | null {
  let s: Store | null = null;
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    s = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8")) as Store;
  } catch (e: any) {
    logger.error(TAG, "readStore fallo", e.message);
    return null;
  }
  if (!s) return null;
  if (!Array.isArray(s.accounts)) s.accounts = [];
  // Migración del formato viejo (una sola cuenta en `tokens`)
  if (s.tokens && s.tokens.username) {
    if (!s.accounts.some((a) => a.username.toLowerCase() === s!.tokens!.username!.toLowerCase())) {
      s.accounts.push({
        username: s.tokens.username,
        access_enc: s.tokens.access_enc,
        refresh_enc: s.tokens.refresh_enc,
        expires_at: s.tokens.expires_at,
        scope: s.tokens.scope,
        added_at: Math.floor(Date.now() / 1000),
      });
    }
    delete s.tokens;
    writeStore(s);
  }
  return s;
}

function writeStore(s: Store): void {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const tmp = STORE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(tmp, STORE_PATH);
}

export function saveConfig(clientId: string, clientSecret: string, redirectUri: string): void {
  const prev = readStore();
  const sameApp = prev && prev.client_id === clientId.trim();
  writeStore({
    client_id: clientId.trim(),
    client_secret_enc: encryptToHex(clientSecret.trim()),
    redirect_uri: (redirectUri || DEFAULT_REDIRECT_URI).trim(),
    // si cambió el client_id, las cuentas viejas ya no sirven
    accounts: sameApp ? prev!.accounts : [],
  });
}

export function disconnectAccount(username?: string): void {
  const s = readStore();
  if (!s) return;
  if (!username) s.accounts = [];
  else s.accounts = s.accounts.filter((a) => a.username.toLowerCase() !== username.toLowerCase());
  writeStore(s);
}

export interface Kick20Account {
  username: string;
  scope: string;
  expires_at: number;
  expired: boolean;
  added_at: number;
}

export interface Kick20Status {
  configured: boolean;
  connected: boolean;
  redirect_uri: string;
  client_id_masked: string | null;
  username: string | null; // primera cuenta (compat)
  accounts: Kick20Account[];
}

export function getStatus(): Kick20Status {
  const s = readStore();
  if (!s || !s.client_id) {
    return {
      configured: false, connected: false, redirect_uri: DEFAULT_REDIRECT_URI,
      client_id_masked: null, username: null, accounts: [],
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const accounts: Kick20Account[] = s.accounts.map((a) => ({
    username: a.username,
    scope: a.scope,
    expires_at: a.expires_at,
    expired: a.expires_at <= now,
    added_at: a.added_at,
  }));
  return {
    configured: true,
    connected: accounts.length > 0,
    redirect_uri: s.redirect_uri,
    client_id_masked: s.client_id.slice(0, 6) + "…" + s.client_id.slice(-4),
    username: accounts[0]?.username ?? null,
    accounts,
  };
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

interface PendingAuth { verifier: string; createdAt: number }
const pending = new Map<string, PendingAuth>();
const PKCE_TTL_MS = 10 * 60_000;

function gcPending(): void {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > PKCE_TTL_MS) pending.delete(k);
}

export function isPendingState(state: string): boolean {
  gcPending();
  return pending.has(state);
}

export function buildAuthUrl(): string {
  const s = readStore();
  if (!s || !s.client_id) throw new Error("kick20 no configurado");
  gcPending();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  pending.set(state, { verifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: s.client_id,
    redirect_uri: s.redirect_uri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return AUTH_URL + "?" + params.toString();
}

// ─── Intercambio / refresh de tokens ─────────────────────────────────────────

async function tokenRequest(body: URLSearchParams): Promise<any | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.error(TAG, "tokenRequest fallo", res.status, text.slice(0, 300));
      return null;
    }
    return JSON.parse(text);
  } catch (e: any) {
    logger.error(TAG, "tokenRequest excepcion", e.message);
    return null;
  }
}

function upsertAccount(s: Store, acc: Account): void {
  const i = s.accounts.findIndex((a) => a.username.toLowerCase() === acc.username.toLowerCase());
  if (i >= 0) s.accounts[i] = { ...s.accounts[i], ...acc };
  else s.accounts.push(acc);
  writeStore(s);
}

export async function exchangeCode(code: string, state: string): Promise<{ ok: boolean; error?: string; username?: string }> {
  const p = pending.get(state);
  if (!p) return { ok: false, error: "state_invalido_o_expirado" };
  pending.delete(state);

  const s = readStore();
  if (!s || !s.client_id) return { ok: false, error: "no_configurado" };

  const raw = await tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: s.client_id,
    client_secret: decryptFromHex(s.client_secret_enc),
    redirect_uri: s.redirect_uri,
    code_verifier: p.verifier,
    code,
  }));
  if (!raw || !raw.access_token) return { ok: false, error: "token_exchange_failed" };

  const username = (await fetchUsername(String(raw.access_token))) || ("cuenta-" + Date.now());
  const expiresIn = Number(raw.expires_in) || 3600;
  upsertAccount(s, {
    username,
    access_enc: encryptToHex(String(raw.access_token)),
    refresh_enc: raw.refresh_token ? encryptToHex(String(raw.refresh_token)) : "",
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    scope: raw.scope || SCOPES,
    added_at: Math.floor(Date.now() / 1000),
  });
  return { ok: true, username };
}

/** Access token válido para una cuenta puntual; refresca y persiste si vence
 *  (o siempre, si `force`). Al refrescar, Kick rota también el refresh token,
 *  así la cuenta se mantiene viva indefinidamente. */
async function accessTokenFor(username: string, force = false): Promise<string | null> {
  const s = readStore();
  if (!s) return null;
  const acc = s.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
  if (!acc) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!force && acc.expires_at > now + 60) return decryptFromHex(acc.access_enc);
  if (!acc.refresh_enc) return acc.expires_at > now ? decryptFromHex(acc.access_enc) : null;

  const raw = await tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: s.client_id,
    client_secret: decryptFromHex(s.client_secret_enc),
    refresh_token: decryptFromHex(acc.refresh_enc),
  }));
  if (!raw || !raw.access_token) return null;

  const fresh = readStore();
  if (!fresh) return null;
  const expiresIn = Number(raw.expires_in) || 3600;
  upsertAccount(fresh, {
    ...acc,
    access_enc: encryptToHex(String(raw.access_token)),
    refresh_enc: raw.refresh_token ? encryptToHex(String(raw.refresh_token)) : acc.refresh_enc,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    scope: raw.scope || acc.scope,
  });
  return String(raw.access_token);
}

export async function forceRefresh(username?: string): Promise<{ ok: boolean; error?: string }> {
  const s = readStore();
  if (!s || s.accounts.length === 0) return { ok: false, error: "sin_cuentas" };
  const targets = username
    ? s.accounts.filter((a) => a.username.toLowerCase() === username.toLowerCase())
    : s.accounts;
  if (targets.length === 0) return { ok: false, error: "cuenta_no_encontrada" };
  let okCount = 0;
  for (const a of targets) {
    const t = await accessTokenFor(a.username, true);
    if (t) okCount++;
  }
  return okCount > 0 ? { ok: true } : { ok: false, error: "refresh_failed" };
}

// ─── Auto-refresh en segundo plano ──────────────────────────────────────────
// Cada hora renueva TODOS los access token (el access dura 2 h, así que con
// refrescar cada 1 h nunca se acercan a vencer). Cada refresh rota también el
// refresh token, por lo que mientras el server corra las cuentas no expiran
// jamás — sin ninguna acción manual ni volver a pasar por el link de Kick.
const AUTO_REFRESH_MS = 60 * 60_000; // 1 hora
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

async function autoRefreshTick(): Promise<void> {
  const s = readStore();
  if (!s || s.accounts.length === 0) return;
  for (const a of s.accounts) {
    try {
      const ok = await accessTokenFor(a.username, true);
      logger.info(TAG, "auto-refresh", a.username, ok ? "ok" : "fallo");
    } catch (e: any) {
      logger.warn(TAG, "auto-refresh excepcion", a.username, e.message);
    }
  }
}

export function startAutoRefresh(): void {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => { autoRefreshTick().catch(() => {}); }, AUTO_REFRESH_MS);
  if (typeof autoRefreshTimer.unref === "function") autoRefreshTimer.unref();
  autoRefreshTick().catch(() => {}); // primera pasada al arrancar
  logger.info(TAG, "auto-refresh de tokens activado (cada 1 h)");
}

// Round-robin entre cuentas para repartir el envío
let rrIndex = 0;
function pickAccountUsername(s: Store): string | null {
  if (s.accounts.length === 0) return null;
  const a = s.accounts[rrIndex % s.accounts.length];
  rrIndex = (rrIndex + 1) % s.accounts.length;
  return a.username;
}

// ─── API pública ─────────────────────────────────────────────────────────────

async function fetchUsername(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(API_USERS_URL, {
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const user = Array.isArray(data?.data) ? data.data[0] : data?.data;
    return user?.name ?? null;
  } catch { return null; }
}

// Cache slug → broadcaster_user_id (evita 1 request extra por mensaje en lotes)
const broadcasterCache = new Map<string, { id: number; at: number }>();
const BROADCASTER_TTL_MS = 30 * 60_000;

async function resolveBroadcasterId(accessToken: string, slug: string): Promise<number | null> {
  const key = slug.trim().toLowerCase();
  const hit = broadcasterCache.get(key);
  if (hit && Date.now() - hit.at < BROADCASTER_TTL_MS) return hit.id;
  try {
    const url = API_CHANNELS_URL + "?slug=" + encodeURIComponent(key);
    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const channel = Array.isArray(data?.data) ? data.data[0] : data?.data;
    const id = channel?.broadcaster_user_id ?? null;
    if (id != null) broadcasterCache.set(key, { id, at: Date.now() });
    return id;
  } catch { return null; }
}

export interface Kick20SendResult {
  ok: boolean;
  status: number;
  error?: string;
  message_id?: string;
  is_sent?: boolean;
  body?: string;
  account?: string;
}

export async function sendAsUser(
  channel: string,
  content: string,
  opts: { username?: string; replyToMessageId?: string } = {}
): Promise<Kick20SendResult> {
  const slug = channel.trim().replace(/^@/, "").toLowerCase();
  if (!slug) return { ok: false, status: 0, error: "canal_requerido" };
  if (!content.trim()) return { ok: false, status: 0, error: "contenido_requerido" };

  const s = readStore();
  if (!s || s.accounts.length === 0) return { ok: false, status: 401, error: "sin_cuentas (conectá una cuenta primero)" };

  const username = opts.username && s.accounts.some((a) => a.username.toLowerCase() === opts.username!.toLowerCase())
    ? opts.username
    : pickAccountUsername(s)!;

  const accessToken = await accessTokenFor(username);
  if (!accessToken) return { ok: false, status: 401, error: "token_invalido:" + username, account: username };

  const broadcasterUserId = await resolveBroadcasterId(accessToken, slug);
  if (broadcasterUserId == null) return { ok: false, status: 404, error: "canal_no_encontrado: " + slug, account: username };

  let safe = content;
  if ([...safe].length > 500) safe = [...safe].slice(0, 500).join("");

  const payload: Record<string, unknown> = {
    broadcaster_user_id: broadcasterUserId,
    content: safe,
    type: "user",
  };
  if (opts.replyToMessageId) payload.reply_to_message_id = opts.replyToMessageId;

  try {
    const res = await fetch(API_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn(TAG, "sendAsUser fallo", res.status, "acc=" + username, text.slice(0, 200));
      return { ok: false, status: res.status, error: "kick_" + res.status, body: text.slice(0, 400), account: username };
    }
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* noop */ }
    return {
      ok: true,
      status: res.status,
      is_sent: parsed?.data?.is_sent ?? true,
      message_id: parsed?.data?.message_id,
      body: text.slice(0, 400),
      account: username,
    };
  } catch (e: any) {
    logger.error(TAG, "sendAsUser excepcion", e.message);
    return { ok: false, status: 0, error: e.message, account: username };
  }
}
