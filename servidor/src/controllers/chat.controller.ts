import type { Request, Response } from "express";
import { sendToKick } from "../services/proxy-controller";
import { logChatActivity } from "../services/auth-manager";
import { validate, ChatSendSchema, ChatSendInput } from "../utils/validators";
import { stmts } from "../models/database";
import type { GenericResponse } from "../types/response";
import { logger } from "../utils/logger";

const TAG = "chat";

export function handleListMyBots(req: Request, res: Response): void {
  const userId = parseInt(req.user!.sub, 10);
  const bots = stmts.listBotsForUser.all(userId);
  const safe = bots.map((b) => ({ id: b.id, bot_name: b.bot_name }));
  res.json({ success: true, bots: safe });
}

export async function handleChatSend(
  req: Request,
  res: Response
): Promise<void> {
  const validation = validate(ChatSendSchema, req.body);
  if (!validation.success) {
    res.status(400).json({
      success: false,
      error:  "Datos invalidos",
      fields: (validation as any).errors,
    } as GenericResponse);
    return;
  }

  const { channel, message, bot_name, chatroom_id } = validation.data as ChatSendInput;
  const userId = parseInt(req.user!.sub, 10);
  const ip     = req.ip ?? req.socket.remoteAddress;

  const result = await sendToKick({ channel, message, userId, botName: bot_name, chatroomId: chatroom_id });

  if (!result.success) {
    logger.warn(TAG, "sendToKick fallo", result.reason);
    res.status(502).json({
      success: false,
      error:   "Error al enviar mensaje",
      message: result.reason,
    } as GenericResponse);
    return;
  }

  logChatActivity(userId, channel, ip);

  res.status(200).json({
    success: true,
    message: "Mensaje enviado correctamente",
  } as GenericResponse);
}
