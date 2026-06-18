import { execSync } from "child_process";
import { getRandomBearer, decryptFromHex } from "./security";
import { stmts } from "../models/database";
import path from "path";
import { logger } from "../utils/logger";
import { sendMessage, type SendMessageConfig, type SendResult } from "./chat-sender.service";

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

const PYTHON_CANDIDATES = [
  process.env.PYTHON_PATH,
  "C:\\Users\\joaqii\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe",
  "python",
  "python3",
  "py",
].filter(Boolean) as string[];

function findPython(): string {
  for (const exe of PYTHON_CANDIDATES) {
    try {
      execSync('"' + exe + '" -c "import tls_client"', { timeout: 3000, encoding: "utf-8" });
      return exe;
    } catch {}
  }
  return "python";
}

const PYTHON = findPython();

function pyExec(...args: string[]): { status: number; body: string } {
  const escaped = args.map(a => '"' + (a || " ").replace(/"/g, '\\"') + '"').join(" ");
  const cmd = '"' + PYTHON + '" "' + SCRIPT + '" ' + escaped;
  const out = execSync(cmd, { timeout: 15000, encoding: "utf-8" }).trim();
  return JSON.parse(out);
}

function logMessage(botId: number | null, userId: number, channel: string, message: string, success: boolean, errorReason?: string): void {
  try {
    stmts.insertMessageLog.run([botId, userId, channel, message.substring(0, 100), success ? 1 : 0, errorReason || null]);
  } catch {}
}

export async function sendToKick(req: ProxyRequest): Promise<ProxyResult> {
  const sentAt = Date.now();

  // Try OAuth first via chat-sender
  const oauthResult = await sendMessage({
    channel: req.channel,
    message: req.message,
    userId: req.userId,
    botName: req.botName,
  });

  if (oauthResult.success) {
    return { success: true, sentAt };
  }

  logger.warn(TAG, "OAuth fallo, intentando Python fallback...", oauthResult.reason);

  // Python fallback
  try {
    let bearer: string | undefined;
    let botId: number | undefined;

    const userBots = stmts.listBotsForUser.all(req.userId);
    if (userBots.length > 0) {
      const bot = userBots[Math.floor(Math.random() * userBots.length)];
      bearer = bot.encrypted_bearer ? decryptFromHex(bot.encrypted_bearer) : undefined;
      botId = bot.id;
    }

    if (!bearer && req.botName) {
      const bot = stmts.findBotByName.get(req.botName);
      if (bot) {
        bearer = bot.encrypted_bearer ? decryptFromHex(bot.encrypted_bearer) : undefined;
        botId = bot.id;
      }
    }

    if (!bearer) {
      bearer = getRandomBearer();
    }

    if (!bearer) {
      logMessage(null, req.userId, req.channel, req.message, false, "No token available");
      return { success: false, reason: "No hay tokens disponibles para enviar mensajes", sentAt };
    }

    let chatroomId = req.chatroomId;
    if (!chatroomId) {
      try {
        const result = pyExec("chatroom", " ", req.channel);
        if (result.status === 200) {
          const inner = JSON.parse(result.body);
          chatroomId = inner?.chatroom?.id;
        }
      } catch (e: any) {
        logger.error(TAG, "getChannelInfo exception", e?.message);
      }
    }

    if (!chatroomId) {
      logMessage(null, req.userId, req.channel, req.message, false, "No chatroomId");
      return { success: false, reason: "El canal no existe o no se pudo verificar", sentAt };
    }

    const result = pyExec("send", bearer, String(chatroomId), req.message);
    if (result.status === 200) {
      logger.info(TAG, "Python OK", "channel=" + req.channel);
      logMessage(botId ?? null, req.userId, req.channel, req.message, true);
      return { success: true, sentAt };
    }

    logger.warn(TAG, "Kick rechazo", "status=" + result.status, "body=" + (result.body || "").substring(0, 200));
    logMessage(botId ?? null, req.userId, req.channel, req.message, false, mapKickError(result.status));
    return { success: false, reason: mapKickError(result.status), sentAt };
  } catch (err: any) {
    logger.error(TAG, "Python error", err.message);
    logMessage(null, req.userId, req.channel, req.message, false, "Python error");
    return { success: false, reason: "Error al enviar el mensaje", sentAt };
  }
}

function mapKickError(status: number): string {
  if (status === 429) return "Demasiadas peticiones. Espera un momento.";
  if (status >= 500) return "El servicio de chat no esta disponible.";
  if (status === 403) return "No tienes permiso para enviar mensajes en este canal.";
  if (status === 404) return "El canal especificado no existe.";
  return "No se pudo enviar el mensaje. Intentalo de nuevo.";
}
