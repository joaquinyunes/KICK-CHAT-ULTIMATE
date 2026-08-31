import { getRandomBearer, loadBearers } from "./security";
import { logger } from "../utils/logger";

const TAG = "kick-bearer";

// Pool de User-Agents: cada bearer usa uno distinto para parecer dispositivos diferentes
const UA_POOL = [
  // Chrome Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  // Chrome Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Firefox Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  // Firefox Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Edge Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  // Safari Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  // Chrome Android
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  // Safari iOS
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
  // Edge Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  // Chrome Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function getUaForBearer(bearer: string | undefined): string {
  if (!bearer) return UA_POOL[0];
  // Hash simple del bearer para asignar UA consistente
  let hash = 0;
  const str = String(bearer);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return UA_POOL[Math.abs(hash) % UA_POOL.length];
}

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
  username?: string;
}

// Contador de mensajes enviados por bearer (en memoria)
const sentCounters = new Map<string, number>();
// Nombre real de Kick por token (se aprende de la respuesta del send)
const tokenUsernames = new Map<string, string | null>();
// Token → username inverso (para stats)
const tokenToUsername = new Map<string, string>();
// Round-robin: índice del próximo bearer a usar (reparte parejo)
let roundRobinIndex = 0;
// Tokens marcados como muertos en esta sesión
const deadTokens = new Set<string>();
// Cooldown por bearer: timestamp del último envío exitoso (60s cooldown)
const bearerCooldown = new Map<string, number>();
const COOLDOWN_MS = 60000; // 60 segundos entre usos del mismo bearer

function isCoolingDown(bearer: string): boolean {
  const last = bearerCooldown.get(bearer);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function markSent(bearer: string): void {
  bearerCooldown.set(bearer, Date.now());
}

// Pool por cola: reparte los 19 vivos en 4 grupos
function getColaPool(pool: string[], cola: string): string[] {
  const alive = pool.filter(t => t && !deadTokens.has(t));
  const colaMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
  const idx = colaMap[cola] ?? 0;
  const perCola = Math.ceil(alive.length / 8);
  const start = idx * perCola;
  return alive.slice(start, start + perCola);
}
export function learnTokenUsername(bearer: string | undefined, username: string | null): void {
  if (!bearer || !username) return;
  tokenUsernames.set(bearer, username);
  tokenToUsername.set(bearer, username);
}
export function getTokenUsername(bearer: string): string | undefined {
  return tokenToUsername.get(bearer);
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
  roundRobinIndex = 0;
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
      headers: { Accept: "application/json, text/plain, */*", "User-Agent": getUaForBearer(b), ...authHeader(b) },
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
  opts: { bearer?: string; chatroomId?: number; cola?: string; random?: boolean } = {}
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

  // Build pool: vivos primero, muertos al final
  const rawPool = (() => {
    try { return loadBearers(); } catch { return [b].filter(Boolean) as string[]; }
  })();

  // Pool global: todos los tokens vivos (sin dividir por cola)
  const pool = rawPool.filter(t => t && !deadTokens.has(t));

  // Filtrar tokens en cooldown
  const available = pool.filter(t => !isCoolingDown(t));
  // Si todos están en cooldown, usar el pool completo (forzar uso)
  const workingPool = available.length > 0 ? available : pool;

  // Orden de intento: round-robin (reparte parejo) o al azar (opts.random)
  const candidates: string[] = [];
  if (workingPool.length > 0) {
    if (opts.random) {
      const shuffled = [...workingPool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      candidates.push(...shuffled);
    } else {
      for (let i = 0; i < workingPool.length; i++) {
        const idx = (roundRobinIndex + i) % workingPool.length;
        if (workingPool[idx]) candidates.push(workingPool[idx]);
      }
      roundRobinIndex = (roundRobinIndex + 1) % workingPool.length;
    }
  } else if (b) {
    candidates.push(b);
  }

  console.log(`[BEARER] cola=${opts.cola||'all'} pool=${pool.length} available=${available.length} rrIdx=${(roundRobinIndex - 1 + workingPool.length) % workingPool.length} msg="${message.substring(0,30)}"`);

  let lastRes: { ok: boolean; status: number; body?: string; bearer?: string; chatroomId?: number; username?: string } | null = null;

  const maxTries = candidates.length;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const candidate = candidates[attempt] || getRandomBearer();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "User-Agent": getUaForBearer(candidate),
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
        markSent(lastRes.bearer);
        console.log(`[BEARER] OK status=200 bearer=${String(candidate).slice(0,12)}… cooldown=60s msg="${message.substring(0,30)}"`);
        try {
          const parsed = JSON.parse(text);
          const uname = parsed?.data?.sender?.username;
          if (uname) {
            learnTokenUsername(candidate, String(uname));
            lastRes.username = String(uname);
          }
        } catch {}
        break;
      }
      if (res.status !== 401 && res.status !== 403) {
        console.log(`[BEARER] FAIL status=${res.status} bearer=${String(candidate).slice(0,12)}… body=${text.substring(0,100)}`);
        break;
      }
      deadTokens.add(candidate);
      logger.warn(TAG, "token muerto, pruebo otro", "status=" + res.status, "token=" + String(candidate).slice(0, 12) + "…");
      continue;
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