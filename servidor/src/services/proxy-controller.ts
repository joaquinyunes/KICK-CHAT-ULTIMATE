import { stmts } from "../models/database";
import { logger } from "../utils/logger";
import { getStatus as getKick20Status, sendAsUser as kick20Send } from "./kick20.service";
import { sendMessage as sendViaBotOAuth } from "./chat-sender.service";

const TAG = "proxy-controller";

export interface ProxyRequest {
  channel: string;
  message: string;
  userId: number;
  botName?: string;
}

export interface ProxyResult {
  success: boolean;
  reason?: string;
  sentAt: number;
  username?: string;
}

function logMessage(userId: number, channel: string, message: string, success: boolean, errorReason?: string): void {
  try {
    stmts.insertMessageLog.run([null, userId, channel, message.substring(0, 100), success ? 1 : 0, errorReason || null]);
  } catch (err) {
    logger.warn(TAG, "No se pudo registrar en message_log", (err as Error).message);
  }
}

/**
 * Envía un mensaje al chat de Kick usando SOLO la API oficial (api.kick.com):
 *  1. Cuenta conectada en /kick20 (OAuth).
 *  2. Bot OAuth asignado al usuario (chat-sender.service).
 */
export async function sendToKick(req: ProxyRequest): Promise<ProxyResult> {
  const sentAt = Date.now();

  try {
    const k20 = getKick20Status();
    if (k20.connected) {
      const r = await kick20Send(req.channel, req.message);
      logMessage(req.userId, req.channel, req.message, r.ok, r.ok ? undefined : r.error || "kick20 " + r.status);
      if (r.ok) {
        logger.info(TAG, "kick20 OAuth OK", "channel=" + req.channel);
        return { success: true, sentAt, username: r.account || k20.username || undefined };
      }
      logger.warn(TAG, "kick20 OAuth fallo", "status=" + r.status, r.error || "");
      return {
        success: false,
        reason: "kick20 (API oficial): " + (r.error || "status " + r.status) + (r.body ? " — " + r.body.slice(0, 200) : ""),
        sentAt,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    logger.error(TAG, "kick20 excepcion", msg);
    return { success: false, reason: "kick20 (API oficial): " + msg, sentAt };
  }

  const r = await sendViaBotOAuth({
    channel: req.channel,
    message: req.message,
    userId: req.userId,
    botName: req.botName,
  });
  return { success: r.success, reason: r.reason, sentAt: r.sentAt };
}
