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
import { validate, ChatSendSchema } from "../utils/validators";

export async function handleChatSend(
  req: Request,
  res: Response
): Promise<void> {
  // 1. Validar body con Zod
  const validation = validate(ChatSendSchema, req.body);
  if (!validation.success) {
    res.status(400).json({
      error:  "Datos inválidos",
      fields: validation.errors,
    });
    return;
  }

  const { channel, message } = validation.data;
  const userId = parseInt(req.user!.sub, 10);
  const ip     = req.ip ?? req.socket.remoteAddress;

  // 2. Delegar al proxy (nunca expone el Bearer al cliente)
  const result = await sendToKick({ channel, message, userId });

  if (!result.success) {
    res.status(502).json({
      error:   "Error al enviar mensaje",
      message: result.reason,
    });
    return;
  }

  // 3. Registrar actividad
  logChatActivity(userId, channel, ip);

  res.status(200).json({
    success: true,
    message: "Mensaje enviado correctamente",
  });
}