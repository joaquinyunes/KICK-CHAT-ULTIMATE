import { getRandomBearer, loadBearers } from "./security";
import { logger } from "../utils/logger";

const TAG = "kick-bearer";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function authHeader(bearer: string | undefined): Record<string, string> {
  if (!bearer) return {};
  const b = bearer.startsWith("Bearer ") ? bearer : "Bearer " + bearer;
  return { Authorization: b };
}

export interface ResolveResult {
  chatId: number | null;
  status: number;
  bearer?: string;
}

export interface BearerSendResult {
  ok: boolean;
  status: number;
  body?: string;
  bearer?: string;
  chatroomId?: number;
}

// Contador de mensajes enviados por bearer (en memoria)
const sentCounters = new Map<string, number>();
// Nombre real de Kick por token (se aprende de la respuesta del send)
const tokenUsernames = new Map<string, string | null>();
export function learnTokenUsername(bearer: string | undefined, username: string | null): void {
  if (!bearer || !username) return;
  tokenUsernames.set(bearer, username);
}
export function getRealUsername(bearer: string): string | null {
  return tokenUsernames.get(bearer) || null;
}
export function countSent(bearer?: string): void {
  if (!bearer) return;
  sentCounters.set(bearer, (sentCounters.get(bearer) || 0) + 1);
}
export function getSentCounters(): Map<string, number> {
  return new Map(sentCounters);
}
export function resetSendCounters(): void {
  sentCounters.clear();
  tokenUsernames.clear();
}

/**
 * Busca el chatroom_id de un canal usando un bearer aleatorio.
 */
export async function resolveChatroomId(
  channelSlug: string,
  bearer?: string
): Promise<ResolveResult> {
  const b = bearer || getRandomBearer();
  const url = "https://kick.com/api/v2/channels/" + encodeURIComponent(channelSlug);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json, text/plain, */*", "User-Agent": UA, ...authHeader(b) },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status !== 200) return { chatId: null, status: res.status, bearer: b };
    const data: any = await res.json();
    const chatId = data?.chatroom?.id ?? data?.id ?? null;
    return { chatId: Number.isFinite(chatId) ? chatId : null, status: res.status, bearer: b };
  } catch (e: any) {
    logger.error(TAG, "resolveChatroomId error", e.message);
    return { chatId: null, status: 0, bearer: b };
  }
}

/**
 * Envía un mensaje con bearer al chatroom dado.
 * Si no se pasa chatroomId, resuelve el canal primero.
 */
export async function sendWithBearer(
  channel: string,
  message: string,
  opts: { bearer?: string; chatroomId?: number } = {}
): Promise<BearerSendResult> {
  let b = opts.bearer;
  let chatId = opts.chatroomId;

  if (chatId == null) {
    const r = await resolveChatroomId(channel, b);
    if (r.chatId == null) {
      return { ok: false, status: r.status, body: "No se pudo resolver el chatroom_id" };
    }
    chatId = r.chatId;
    b = r.bearer;
  }

  const url = `https://kick.com/api/v2/messages/send/${chatId}`;
  const ref = String(Date.now());
  const payload = { content: message, type: "message", message_ref: ref };

  // Build pool of tokens to try (no repeats) + barajar para repartir emisores
  const pool = (() => {
    try { return loadBearers(); } catch { return [b].filter(Boolean) as string[]; }
  })();
  const candidates = opts.bearer
    ? [opts.bearer, ...pool.filter(x => x !== opts.bearer && x)]
    : (b && pool.length ? [...pool.filter(x => x && x !== b), b] : [...pool]);

  // Fisher–Yates: cada mensaje arranca con un bearer aleatorio distinto
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let lastRes: { ok: boolean; status: number; body?: string; bearer?: string; chatroomId?: number } | null = null;

  const maxTries = Math.min(Math.max(candidates.length, 1), 8);
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const candidate = candidates[attempt] || getRandomBearer();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": UA,
          "Content-Type": "application/json",
          ...authHeader(candidate),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      const text = await res.text();
      lastRes = { ok: res.status === 200, status: res.status, body: text, bearer: candidate, chatroomId: chatId };
      // 200 → éxito; 403/401 → probar otro token; otro error (429/500) → no rotar, falla de servidor
      if (res.status === 200) {
        countSent(lastRes.bearer);
        try {
          const parsed = JSON.parse(text);
          const uname = parsed?.data?.sender?.username;
          if (uname) learnTokenUsername(candidate, String(uname));
        } catch {}
        break;
      }
      if (res.status !== 401 && res.status !== 403) break;
      logger.warn(TAG, "token muerto, pruebo otro", "status=" + res.status, "token=" + String(candidate).slice(0, 12) + "…");
    } catch (e: any) {
      lastRes = { ok: false, status: 0, body: e.message, bearer: candidate, chatroomId: chatId };
      logger.error(TAG, "send excepcion", e.message);
      break;
    }
  }

  if (!lastRes) {
    return { ok: false, status: 0, body: "Sin canales disponibles" };
  }
  if (!lastRes.ok) {
    logger.warn(TAG, "send fallo final", "status=" + lastRes.status, "msg=" + message.substring(0, 60));
  }
  return lastRes;
}