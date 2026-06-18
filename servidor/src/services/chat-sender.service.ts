import { stmts } from "../models/database";
import { logger } from "../utils/logger";
import { KickApiError, type ChatSendResult } from "../types/kick";
import { getBotAccessToken, sendViaOfficialApi, getBroadcasterUserId } from "./kick-oauth";

const TAG = "chat-sender";

export interface SendMessageConfig {
  channel: string;
  message: string;
  userId: number;
  botName?: string;
}

export interface SendResult {
  success: boolean;
  reason?: string;
  sentAt: number;
  status?: number;
}

function pickBot(userId: number, botName?: string): { botId: number } | null {
  if (botName) {
    const bot = stmts.findBotByName.get(botName);
    if (!bot || !bot.oauth_refresh_token) return null;
    return { botId: bot.id };
  }

  const userBots = stmts.listBotsForUser.all(userId);
  if (userBots.length > 0) {
    const bot = userBots[Math.floor(Math.random() * userBots.length)];
    if (!bot.oauth_refresh_token) return null;
    return { botId: bot.id };
  }

  const anyBot = (stmts.listAllBots?.all?.() || []).find((b: any) => b.oauth_refresh_token);
  if (anyBot) return { botId: anyBot.id };

  return null;
}

export async function sendMessage(config: SendMessageConfig): Promise<SendResult> {
  const sentAt = Date.now();

  const picked = pickBot(config.userId, config.botName);
  if (!picked) {
    return { success: false, reason: "No hay bots OAuth disponibles. Configura un bot con OAuth.", sentAt };
  }

  const accessToken = await getBotAccessToken(picked.botId);
  if (!accessToken) {
    return { success: false, reason: "No se pudo obtener token de acceso para el bot.", sentAt };
  }

  const broadcasterUserId = await getBroadcasterUserId(accessToken, config.channel);
  if (broadcasterUserId == null) {
    return { success: false, reason: "No se encontro el canal: " + config.channel, sentAt };
  }

  const result = await sendViaOfficialApi(accessToken, config.message, broadcasterUserId);
  if (!result.ok) {
    logger.warn(TAG, "sendMessage fallo", config.channel, "status=" + result.status);
    return { success: false, reason: mapError(result.status), sentAt, status: result.status };
  }

  logger.info(TAG, "Mensaje enviado OK", config.channel, "botId=" + picked.botId);
  logMessage(picked.botId, config.userId, config.channel, config.message, true);
  return { success: true, sentAt };
}

function mapError(status: number): string {
  if (status === 429) return "Demasiadas peticiones. Espera un momento.";
  if (status >= 500) return "El servicio de chat no esta disponible.";
  if (status === 403) return "No tienes permiso para enviar mensajes en este canal.";
  if (status === 404) return "El canal especificado no existe.";
  return "No se pudo enviar el mensaje. Intentalo de nuevo.";
}

function logMessage(botId: number, userId: number, channel: string, message: string, success: boolean, errorReason?: string): void {
  try {
    stmts.insertMessageLog.run([botId, userId, channel, message.substring(0, 100), success ? 1 : 0, errorReason || null]);
  } catch {}
}

export async function replyToMessage(
  config: SendMessageConfig & { replyId: string }
): Promise<SendResult> {
  const prefix = "@" + config.replyId + " ";
  const maxLen = 500 - prefix.length;
  const message = maxLen > 0 ? prefix + config.message.slice(0, maxLen) : config.message.slice(0, 500);
  return sendMessage({ ...config, message });
}
