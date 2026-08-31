import fs from "fs";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { sendWithBearer, resolveChatroomId } from "./bearer-sender.service";

/**
 * Envío server-side de las líneas que genera el pipeline de contexto (KC).
 *
 * KC solo genera y deja el lote; ACÁ lo mandamos al chat de Kick con el pool
 * de bearers, espaciado, sin depender de que el panel esté abierto en un
 * navegador. Lo alimenta kc-ingest.service cuando entra un lote nuevo.
 */

const TAG = "kc-sender";

let queue: string[] = [];
let timer: NodeJS.Timeout | null = null;
let chatId: number | null = null;
let chatIdChannel = "";

const state = {
  sent: 0,
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
const CFG_FILE = path.resolve(process.cwd(), "data", "context-chat", "send_config.json");

export interface KcSendConfig {
  minSeg: number;
  maxSeg: number;
  bearerRandom: boolean;
}

let sendCfg: KcSendConfig | null = null;

function loadSendCfg(): KcSendConfig {
  if (sendCfg) return sendCfg;
  const def: KcSendConfig = {
    minSeg: Math.max(3, Number(env.KC_SEND_INTERVAL_SEG) || 10) - 3,
    maxSeg: Math.max(3, Number(env.KC_SEND_INTERVAL_SEG) || 10) + 6,
    bearerRandom: true,
  };
  try {
    const d = JSON.parse(fs.readFileSync(CFG_FILE, "utf-8"));
    sendCfg = {
      minSeg: Math.max(2, Number(d.minSeg) || def.minSeg),
      maxSeg: Math.max(2, Number(d.maxSeg) || def.maxSeg),
      bearerRandom: d.bearerRandom !== false,
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
    bearerRandom: c.bearerRandom ?? cur.bearerRandom,
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

/** Delay aleatorio (ms) entre el mínimo y el máximo configurados. */
function nextDelayMs(): number {
  const c = loadSendCfg();
  const lo = c.minSeg * 1000;
  const hi = c.maxSeg * 1000;
  return Math.round(lo + Math.random() * Math.max(0, hi - lo));
}

/** kc-ingest llama esto cuando absorbe un lote nuevo. */
export function enqueueKcLines(lines: string[], loteTs: number): void {
  if (!enabled()) return;

  if (!channel()) {
    state.lastError = "KC_SEND_CHANNEL / KICK_CANAL_SLUG sin definir — no se envía nada";
    logger.warn(TAG, state.lastError);
    return;
  }

  // El contexto nuevo pisa al viejo: no acumulamos líneas atrasadas.
  const dropped = queue.length;
  queue = lines.filter((l) => l && l.trim());
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
  const msg = queue.shift() as string;

  try {
    if (chatId == null || chatIdChannel !== ch) {
      const r = await resolveChatroomId(ch);
      chatId = r.chatId;
      chatIdChannel = ch;
      if (chatId == null) throw new Error(`no se pudo resolver el canal "${ch}" (status ${r.status})`);
    }
    const res = await sendWithBearer(ch, msg, { chatroomId: chatId, cola: "kc", random: loadSendCfg().bearerRandom });
    if (res.ok) {
      state.sent += 1;
      state.lastSentAt = Date.now();
    } else {
      state.failed += 1;
      state.lastError = `Kick status ${res.status}`;
    }
  } catch (e: any) {
    state.failed += 1;
    state.lastError = e.message;
    logger.warn(TAG, `Envío falló: ${e.message}`);
  }

  if (queue.length > 0) {
    timer = setTimeout(tick, nextDelayMs());
    timer.unref?.();
  }
}

export function clearKcSender(): void {
  queue = [];
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
  failed: number;
  lastSentAt: number;
  lastError: string;
  lastLoteTs: number;
  minSeg: number;
  maxSeg: number;
  bearerRandom: boolean;
}

export function getKcSenderStatus(): KcSenderStatus {
  const c = loadSendCfg();
  return {
    enabled: enabled(),
    channel: channel(),
    queued: queue.length,
    sent: state.sent,
    failed: state.failed,
    lastSentAt: state.lastSentAt,
    lastError: state.lastError,
    lastLoteTs: state.lastLoteTs,
    minSeg: c.minSeg,
    maxSeg: c.maxSeg,
    bearerRandom: c.bearerRandom,
  };
}
