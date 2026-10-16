import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { sendAsUser, listAccountUsernames, recentAccountUsernames, pickLeastUsed, tickMessage, takeDouble } from "./kick20.service";

/**
 * Envío server-side de las líneas que genera el pipeline de contexto (KC).
 *
 * KC solo genera y deja el lote; ACÁ lo mandamos al chat de Kick con la API
 * oficial (cuentas OAuth conectadas en /kick20), espaciado, sin depender de que el panel esté abierto en un
 * navegador. Lo alimenta kc-ingest.service cuando entra un lote nuevo.
 *
 * Cada línea del lote trae `autor` (una voz Pn del prompt) y `reply_a` (el n de
 * la línea a la que contesta). Con eso:
 *  - cada voz se envía siempre desde la misma cuenta (persona_map.json), sin
 *    ciclos fijos: quién habla lo decide la conversación, no un contador;
 *  - una respuesta nunca sale de la misma cuenta a la que le contesta;
 *  - un porcentaje de las respuestas se publica como respuesta nativa de Kick
 *    (reply_to_message_id) al mensaje que ya se envió.
 */

const TAG = "kc-sender";

/** Línea del lote. `texto` es la versión plana; `raw` conserva [EMOTE:X] y @Pn. */
export interface KcLine {
  n?: number;
  autor?: string;
  reply_a?: number | null;
  texto: string;
  raw?: string;
}

let queue: KcLine[] = [];
let timer: NodeJS.Timeout | null = null;
/** Mensajes ya enviados del lote actual: n → id de Kick y cuenta que lo escribió. */
const sentInBatch = new Map<number, { messageId: string; account: string }>();

const state = {
  sent: 0,
  replied: 0,
  failed: 0,
  lastSentAt: 0,
  lastError: "",
  lastLoteTs: 0,
};

function enabled(): boolean {
  const v = (env.KC_SEND_ENABLED || "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

function channel(): string {
  return (env.KC_SEND_CHANNEL || env.KICK_CANAL_SLUG || "").trim();
}

// ─────────────────────────────────────────────────────────────────────
// Ajustes de envío editables desde el panel /kc
const DATA_DIR = path.resolve(process.cwd(), "data", "context-chat");
const CFG_FILE = path.join(DATA_DIR, "send_config.json");

export interface KcSendConfig {
  minSeg: number;
  maxSeg: number;
  /** % de las respuestas que se publican como respuesta nativa de Kick (0-100). */
  replyPct: number;
}

let sendCfg: KcSendConfig | null = null;

function clampPct(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

function loadSendCfg(): KcSendConfig {
  if (sendCfg) return sendCfg;
  const base = Math.max(3, Number(env.KC_SEND_INTERVAL_SEG) || 10);
  const def: KcSendConfig = {
    minSeg: base - 3,
    maxSeg: base + 6,
    replyPct: clampPct(process.env.KC_SEND_REPLY_PCT, 40),
  };
  try {
    const d = JSON.parse(fs.readFileSync(CFG_FILE, "utf-8"));
    sendCfg = {
      minSeg: Math.max(2, Number(d.minSeg) || def.minSeg),
      maxSeg: Math.max(2, Number(d.maxSeg) || def.maxSeg),
      replyPct: clampPct(d.replyPct, def.replyPct),
    };
  } catch {
    sendCfg = def;
  }
  if (sendCfg.maxSeg < sendCfg.minSeg) sendCfg.maxSeg = sendCfg.minSeg;
  return sendCfg;
}

export function getSendConfig(): KcSendConfig {
  return { ...loadSendCfg() };
}

export function setSendConfig(c: Partial<KcSendConfig>): KcSendConfig {
  const cur = loadSendCfg();
  const next: KcSendConfig = {
    minSeg: Math.max(2, Math.round(Number(c.minSeg ?? cur.minSeg))),
    maxSeg: Math.max(2, Math.round(Number(c.maxSeg ?? cur.maxSeg))),
    replyPct: clampPct(c.replyPct ?? cur.replyPct, cur.replyPct),
  };
  if (next.maxSeg < next.minSeg) next.maxSeg = next.minSeg;
  sendCfg = next;
  try {
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true });
    fs.writeFileSync(CFG_FILE, JSON.stringify(next, null, 2), "utf-8");
  } catch (e: any) {
    logger.warn(TAG, `no se pudo guardar send_config: ${e.message}`);
  }
  return next;
}

/**
 * Delay aleatorio (ms) hasta la línea siguiente. Tres ritmos distintos, para que
 * el chat no salga con cadencia de metrónomo:
 *  - ráfaga (la misma voz sigue escribiendo): muy rápido, como alguien que manda
 *    2 o 3 mensajes seguidos;
 *  - dentro de un hilo (la línea contesta a otra): rápido;
 *  - entre hilos: pausa un poco mayor.
 */
function nextDelayMs(next?: KcLine): number {
  const c = loadSendCfg();
  if (next && isBurstContinuation(next)) {
    const lo = Math.max(700, c.minSeg * 1000 * 0.15);
    const hi = Math.max(lo + 600, c.minSeg * 1000 * 0.45);
    return Math.round(lo + Math.random() * (hi - lo));
  }
  const k = next && next.reply_a != null ? 0.75 : 1.5;
  const lo = Math.max(1500, c.minSeg * 1000 * k);
  const hi = Math.max(lo, c.maxSeg * 1000 * k);
  return Math.round(lo + Math.random() * (hi - lo));
}

// ─────────────────────────────────────────────────────────────────────
// Ráfagas: el lote ya trae tandas de 1, 2 o 3 líneas seguidas del mismo autor
// (lo pide el prompt del comentarista). Acá sólo hay que respetarlas: la misma
// voz sigue hablando desde la misma cuenta y con menos pausa, en vez de rotar
// de cuenta en cada línea.
let lastSent: { autor?: string; account?: string } = {};

/** ¿Esta línea continúa la ráfaga de la línea anterior (mismo autor)? */
function isBurstContinuation(line?: KcLine): boolean {
  return !!(line?.autor && lastSent.autor && line.autor === lastSent.autor);
}

// ─────────────────────────────────────────────────────────────────────
// Voz (Pn) → cuenta. Se sortea de nuevo en cada tanda: dentro de la tanda una
// voz habla siempre desde la misma cuenta (menciones y respuestas coherentes),
// pero entre tandas no hay mapa fijo. Un mapa persistente hacía que el orden
// de autores del modelo (P3, P4, P6...) repitiera siempre el mismo ciclo de cuentas.
const batchPersonaMap = new Map<string, string>();

/** Cuenta de una voz en esta tanda. Si no tiene, se sortea entre las cuentas que aún no usó otra voz. */
function accountForPersona(persona: string, names: string[]): string {
  const current = batchPersonaMap.get(persona);
  if (current && names.some((n) => n.toLowerCase() === current.toLowerCase())) return current;

  const taken = new Set([...batchPersonaMap.values()].map((u) => u.toLowerCase()));
  const free = names.filter((n) => !taken.has(n.toLowerCase()));
  // la menos usada, no al azar: así en pocas tandas hablan todas las cuentas
  const chosen = pickLeastUsed(free.length > 0 ? free : names);
  batchPersonaMap.set(persona, chosen);
  return chosen;
}

/** Cuenta con la que se envía una línea, o undefined para que sendAsUser sortee una. */
function chooseAccount(line: KcLine, parentAccount?: string): string | undefined {
  const names = listAccountUsernames();
  if (names.length === 0 || !line.autor) return undefined;

  // Ráfaga: la misma voz sigue escribiendo, así que sale de la misma cuenta
  // aunque sea el mensaje inmediato anterior del chat.
  if (isBurstContinuation(line) && lastSent.account) return lastSent.account;

  const recent = recentAccountUsernames();
  const last = recent[recent.length - 1];
  const l = (s: string) => s.toLowerCase();
  // nunca la misma cuenta dos veces seguidas, ni contestándose a sí misma
  const bad = (n: string) =>
    names.length > 1 && ((!!parentAccount && l(n) === l(parentAccount)) || l(n) === last);

  const preferred = accountForPersona(line.autor, names);
  if (!bad(preferred)) return preferred;
  const alternatives = names.filter((n) => l(n) !== l(preferred) && !bad(n));
  if (alternatives.length === 0) return preferred;
  // Si la cuenta de esa voz no sirve para esta línea, la voz se queda con la
  // alternativa: si no, la misma voz cambiaba de cuenta en medio de la tanda.
  const alternativa = pickLeastUsed(alternatives);
  batchPersonaMap.set(line.autor, alternativa);
  return alternativa;
}

// ─────────────────────────────────────────────────────────────────────
// Texto final: menciones entre voces y emotes.

// Ids de emotes de Kick. Los dos primeros salen del ejemplo de la doc oficial
// (docs.kick.com/events/event-types); el resto se agrega en emotes.json.
const EMOTES_FILE = path.join(DATA_DIR, "emotes.json");
const DEFAULT_EMOTE_IDS: Record<string, string> = { kekw: "37226", hyperclap: "4148074" };

function emoteIds(): Record<string, string> {
  const ids = { ...DEFAULT_EMOTE_IDS };
  try {
    const d = JSON.parse(fs.readFileSync(EMOTES_FILE, "utf-8"));
    for (const [k, v] of Object.entries(d ?? {})) ids[k.toLowerCase()] = String(v);
  } catch {
    /* sin archivo: solo los ids por defecto */
  }
  return ids;
}

/** Los emotes como [emote:ID:nombre] solo si KC_SEND_EMOTES=1 (la doc no confirma que el POST /chat los interprete). */
function sendEmotes(): boolean {
  const v = (process.env.KC_SEND_EMOTES || "0").toLowerCase();
  return v === "1" || v === "true" || v === "si";
}

function renderText(line: KcLine, sender?: string): string {
  const source = line.raw ?? line.texto;
  const names = listAccountUsernames();
  let out = source.replace(/@(P\d{1,2})\b/gi, (_m, slot: string) => {
    if (names.length === 0) return "";
    const target = accountForPersona(slot.toUpperCase(), names);
    // no se menciona a sí misma: si esa voz cae en la cuenta que escribe, se saca
    return sender && target.toLowerCase() === sender.toLowerCase() ? "" : "@" + target;
  });
  const ids = sendEmotes() ? emoteIds() : {};
  out = out.replace(/\[EMOTE:\s*([A-Za-z0-9_]+)\s*\]/gi, (_m, name: string) => {
    const id = ids[name.toLowerCase()];
    return id ? `[emote:${id}:${name}]` : name;
  });
  return out.replace(/\s+/g, " ").trim();
}

// ─────────────────────────────────────────────────────────────────────

/**
 * Tope duro de ráfagas. El prompt le pide al modelo casi todo de a un mensaje,
 * pero no lo cumple de forma fiable (y un pipeline sin reiniciar sigue con el
 * prompt viejo), así que acá se fuerza: dos líneas seguidas del mismo autor solo
 * se respetan cuando le toca una doble al contador (~1 cada 15 mensajes, ver
 * kick20.service); nunca 3. Cualquier otra línea repetida pasa a otra voz del lote
 * (nunca la anterior ni la siguiente, para no armar otra ráfaga); si no hay otra,
 * se le inventa una voz nueva. Los @Pn y los responde_a no cambian.
 */
function limitarRafagas(lines: KcLine[]): KcLine[] {
  const voces = [...new Set(lines.map((l) => l.autor).filter((a): a is string => !!a))];
  let nuevas = 0;
  let prev = "";
  let run = 0;
  const out: KcLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    tickMessage();
    if (!l.autor) { prev = ""; run = 0; out.push(l); continue; }
    if (l.autor === prev && !(run === 1 && takeDouble())) {
      const siguiente = lines[i + 1]?.autor;
      const candidatas = voces.filter((v) => v !== prev && v !== siguiente && v !== l.autor);
      const voz = candidatas.length > 0
        ? candidatas[Math.floor(Math.random() * candidatas.length)]
        : `X${++nuevas}`;
      l = { ...l, autor: voz };
    }
    if (l.autor === prev) {
      run++;
    } else {
      prev = l.autor!;
      run = 1;
    }
    out.push(l);
  }
  return out;
}

/** kc-ingest llama esto cuando absorbe un lote nuevo. */
export function enqueueKcLines(lines: Array<string | KcLine>, loteTs: number): void {
  if (!enabled()) return;

  if (!channel()) {
    state.lastError = "KC_SEND_CHANNEL / KICK_CANAL_SLUG sin definir — no se envía nada";
    logger.warn(TAG, state.lastError);
    return;
  }

  // El contexto nuevo pisa al viejo: no acumulamos líneas atrasadas.
  const dropped = queue.length;
  queue = limitarRafagas(
    lines
      .map((l): KcLine => (typeof l === "string" ? { texto: l } : l))
      .filter((l) => l && l.texto && l.texto.trim())
  );
  sentInBatch.clear();
  batchPersonaMap.clear();
  // lote nuevo = mapa de voces nuevo: no arrastramos la ráfaga del anterior.
  lastSent = {};
  state.lastLoteTs = loteTs;
  state.lastError = "";
  logger.info(
    TAG,
    `Encolado lote ${loteTs}: ${queue.length} líneas${dropped ? ` (descarté ${dropped} viejas sin enviar)` : ""}`
  );
  ensureTimer();
}

function ensureTimer(): void {
  if (timer || queue.length === 0) return;
  timer = setTimeout(tick, 500);
  timer.unref?.();
}

async function tick(): Promise<void> {
  timer = null;
  if (queue.length === 0) return;
  if (!enabled()) {
    queue = [];
    return;
  }

  const ch = channel();
  const line = queue.shift() as KcLine;

  try {
    const parent = line.reply_a != null ? sentInBatch.get(line.reply_a) : undefined;
    const account = chooseAccount(line, parent?.account);
    const asReply =
      !!parent &&
      parent.account.toLowerCase() !== (account ?? "").toLowerCase() &&
      Math.random() * 100 < loadSendCfg().replyPct;

    const res = await sendAsUser(ch, renderText(line, account), {
      username: account,
      replyToMessageId: asReply ? parent!.messageId : undefined,
    });
    if (res.ok) {
      lastSent = { autor: line.autor, account: res.account ?? account ?? lastSent.account };
      state.sent += 1;
      if (asReply) state.replied += 1;
      state.lastSentAt = Date.now();
      if (line.n != null && res.message_id) {
        sentInBatch.set(line.n, { messageId: res.message_id, account: res.account ?? account ?? "" });
      }
    } else {
      state.failed += 1;
      state.lastError = `Kick ${res.error || res.status}`;
    }
  } catch (e: any) {
    state.failed += 1;
    state.lastError = e.message;
    logger.warn(TAG, `Envío falló: ${e.message}`);
  }

  if (queue.length > 0) {
    timer = setTimeout(tick, nextDelayMs(queue[0]));
    timer.unref?.();
  }
}

export function clearKcSender(): void {
  queue = [];
  sentInBatch.clear();
  batchPersonaMap.clear();
  lastSent = {};
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export interface KcSenderStatus {
  enabled: boolean;
  channel: string;
  queued: number;
  sent: number;
  replied: number;
  failed: number;
  lastSentAt: number;
  lastError: string;
  lastLoteTs: number;
  minSeg: number;
  maxSeg: number;
  replyPct: number;
}

export function getKcSenderStatus(): KcSenderStatus {
  const c = loadSendCfg();
  return {
    enabled: enabled(),
    channel: channel(),
    queued: queue.length,
    sent: state.sent,
    replied: state.replied,
    failed: state.failed,
    lastSentAt: state.lastSentAt,
    lastError: state.lastError,
    lastLoteTs: state.lastLoteTs,
    minSeg: c.minSeg,
    maxSeg: c.maxSeg,
    replyPct: c.replyPct,
  };
}
