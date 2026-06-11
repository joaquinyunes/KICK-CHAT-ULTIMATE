// controllers/chat.controller.ts - Controlador del endpoint /chat/send
/**
 * controllers/chat.controller.ts
 * Controlador para POST /chat/send
 *
 * Separa la lógica HTTP (Request/Response) del servicio de negocio.
 */

import type { Request, Response } from "express";
import { sendToKick }            from "../services/proxy-controller";
import { logChatActivity }       from "../services/auth-manager";
import { validate, ChatSendSchema, ChatSendInput } from "../utils/validators";
import { stmts }                 from "../models/database";
import type { GenericResponse }  from "../types/response";

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
  // 1. Validar body con Zod
  const validation = validate(ChatSendSchema, req.body);
  if (!validation.success) {
    res.status(400).json({
      success: false,
      error:  "Datos inválidos",
      fields: (validation as any).errors,
    } as GenericResponse);
    return;
  }

  const { channel, message, bot_name } = validation.data as ChatSendInput;
  const userId = parseInt(req.user!.sub, 10);
  const ip     = req.ip ?? req.socket.remoteAddress;

  // 2. Delegar al proxy con el bot específico
  const result = await sendToKick({ channel, message, userId, botName: bot_name });

  if (!result.success) {
    res.status(502).json({
      success: false,
      error:   "Error al enviar mensaje",
      message: result.reason,
    } as GenericResponse);
    return;
  }

  // 3. Registrar actividad
  logChatActivity(userId, channel, ip);

  res.status(200).json({
    success: true,
    message: "Mensaje enviado correctamente",
  } as GenericResponse);
}