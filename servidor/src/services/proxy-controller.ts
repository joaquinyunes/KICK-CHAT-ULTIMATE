import { execSync } from "child_process";
import { getRandomBearer, decryptFromHex } from "./security";
import { stmts } from "../models/database";
import path from "path";
import { logger } from "../utils/logger";
import { sendViaPlaywright } from "./playwright-sender.service";
import { findPython } from "../utils/python";
import { mapKickError } from "../utils/kick";
import { sendWithBearer, resolveChatroomId } from "./bearer-sender.service";

const TAG = "proxy-controller";

export interface ProxyRequest {
  channel: string;
  message: string;
  userId: number;
  botName?: string;
  chatroomId?: number;
}

export interface ProxyResult {
  success: boolean;
  reason?: string;
  sentAt: number;
}

const SCRIPT = path.resolve(process.cwd(), "send_to_kick.py");

const PYTHON = findPython("tls_client");

function pyExec(...args: string[]): { status: number; body: string } {
  if (!PYTHON) return { status: 0, body: "Python no está disponible en este sistema" };
  const cmd = '"' + PYTHON + '" "' + SCRIPT + '"';
  const input = JSON.stringify(args);
  const out = execSync(cmd, { timeout: 15000, encoding: "utf-8", input }).trim();
  if (!out) return { status: 0, body: "Python no devolvio salida" };
  try { return JSON.parse(out); } catch { logger.error(TAG, "JSON invalido de Python", out?.substring(0, 500)); return { status: 0, body: out?.substring(0, 200) || "error" }; }
}

function logMessage(botId: number | null, userId: number, channel: string, message: string, success: boolean, errorReason?: string): void {
  try {
    stmts.insertMessageLog.run([botId, userId, channel, message.substring(0, 100), success ? 1 : 0, errorReason || null]);
  } catch {}
}

export async function sendToKick(req: ProxyRequest): Promise<ProxyResult> {
  const sentAt = Date.now();

  const triedBots: string[] = [];
  let lastError = "No hay tokens disponibles para enviar mensajes";

  // ── Estrategia 1: Node directo con bearer (no requiere Python) ──
  try {
    let chatroomId = req.chatroomId;
    if (chatroomId == null) {
      const r = await resolveChatroomId(req.channel);
      chatroomId = r.chatId ?? undefined;
    }
    if (chatroomId != null) {
      const res = await sendWithBearer(req.channel, req.message, { chatroomId });
      if (res.ok) {
        logger.info(TAG, "Bearer OK", "channel=" + req.channel);
        logMessage(null, req.userId, req.channel, req.message, true);
        return { success: true, sentAt };
      }
      triedBots.push("bearer(" + res.status + ")");
      lastError = mapKickError(res.status, res.body || "");
    } else {
      triedBots.push("bearer(no chatroom)");
      lastError = "No se pudo resolver el chatroom del canal: " + req.channel;
    }
  } catch (err: any) {
    triedBots.push("bearer(error)");
    lastError = err.message || "Error al usar bearer";
  }

  // ── Estrategia 2: por bot con Python (si está disponible) ──
  if (PYTHON) {
  let candidateBots: any[] = stmts.listBotsForUser.all(req.userId);
  if (candidateBots.length === 0) {
    candidateBots = stmts.listAllBots.all();
  }
  if (req.botName) {
    candidateBots = candidateBots.filter((b: any) => b.bot_name === req.botName);
    if (candidateBots.length === 0) {
      const named = stmts.findBotByName.get(req.botName);
      if (named) candidateBots.push(named);
    }
  }

  const shuffled = candidateBots.sort(() => Math.random() - 0.5);
  const maxAttempts = Math.min(shuffled.length, 3);
  for (let i = 0; i < maxAttempts; i++) {
    const bot = shuffled[i];
    triedBots.push(bot.bot_name);
    try {
      let bearer: string | undefined;
      try { bearer = decryptFromHex(bot.encrypted_bearer); } catch {}
      if (!bearer) { lastError = "Bearer invalido para " + bot.bot_name; continue; }

      const result = pyExec("send_to_channel", bearer, req.channel, req.message);
      if (result.status === 200) {
        logger.info(TAG, "Python OK", "channel=" + req.channel, "bot=" + bot.bot_name);
        logMessage(bot.id, req.userId, req.channel, req.message, true);
        return { success: true, sentAt };
      }
      logger.warn(TAG, "Fallo bot " + bot.bot_name, "status=" + result.status, "body=" + (result.body || "").substring(0, 200));
      lastError = mapKickError(result.status, result.body);
      logMessage(bot.id, req.userId, req.channel, req.message, false, lastError);
    } catch (err: any) {
      logger.error(TAG, "Error con bot " + bot.bot_name, err.message);
      lastError = "Error ejecutando Python: " + (err.message || "desconocido");
    }
  }
  } else {
    lastError = lastError + " (Python no disponible: se omitió el fallback con Python)";
  }

  // Fallback: cookies + bearer (try ALL bots with cookies, not just user's)
  let cookiesBot: any;
  if (req.botName) {
    cookiesBot = stmts.listAllBots.all().find((b: any) => b.bot_name === req.botName && b.cookies);
  }
  if (!cookiesBot) {
    cookiesBot = stmts.listAllBots.all().find((b: any) => b.cookies);
  }
  if (cookiesBot && cookiesBot.cookies) {
    triedBots.push(cookiesBot.bot_name + "(cookies)");
    try {
      const parsed = JSON.parse(cookiesBot.cookies);
      let botBearer: string | undefined;
      try { botBearer = decryptFromHex(cookiesBot.encrypted_bearer); } catch {}
      if (Array.isArray(parsed) && parsed.length > 0) {
        const pwResult = sendViaPlaywright(req.channel, req.message, parsed, botBearer);
        if (pwResult.success) {
          logMessage(cookiesBot.id, req.userId, req.channel, req.message, true);
          return { success: true, sentAt };
        }
        lastError = pwResult.reason || "Error enviando por cookies";
        logMessage(cookiesBot.id, req.userId, req.channel, req.message, false, "Cookies: " + lastError);
      }
    } catch {}
  }

  if (triedBots.length === 0) triedBots.push("sin bots");
  return { success: false, reason: "Intenté con: " + triedBots.join(", ") + " — " + lastError, sentAt };
}


