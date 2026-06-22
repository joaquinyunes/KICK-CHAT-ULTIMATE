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

export function handleListPools(_req: Request, res: Response): void {
  const pools = stmts.listPools.all().map((p) => ({
    id: p.id, name: p.name, messages: JSON.parse(p.messages || "[]"),
  }));
  res.json({ success: true, pools });
}

export function handleCreatePool(req: Request, res: Response): void {
  const { name, messages } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name es requerido" }); return;
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages debe ser un array con al menos un mensaje" }); return;
  }
  try {
    const result = stmts.insertPool.run([name, JSON.stringify(messages)]);
    res.status(201).json({ success: true, id: result.lastInsertRowid, name });
  } catch {
    res.status(409).json({ error: "Ya existe un pool con ese nombre" });
  }
}

export function handleDeletePool(req: Request, res: Response): void {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "id invalido" }); return; }
  stmts.deletePool.run([id]);
  res.json({ success: true });
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

export async function handleSendRandom(req: Request, res: Response): Promise<void> {
  const { channel, pool_id } = req.body;
  if (!channel || typeof channel !== "string") {
    res.status(400).json({ success: false, error: "channel es requerido" }); return;
  }
  if (!pool_id || typeof pool_id !== "number") {
    res.status(400).json({ success: false, error: "pool_id es requerido" }); return;
  }

  const pool = stmts.findPoolById.get([pool_id]);
  if (!pool) {
    res.status(404).json({ success: false, error: "Pool no encontrado" }); return;
  }

  let messages: string[];
  try { messages = JSON.parse(pool.messages); } catch { messages = []; }
  if (messages.length === 0) {
    res.status(400).json({ success: false, error: "Pool vacio" }); return;
  }

  const message = messages[Math.floor(Math.random() * messages.length)];
  const userId = parseInt(req.user!.sub, 10);
  const ip = req.ip ?? req.socket.remoteAddress;

  const result = await sendToKick({ channel, message, userId });

  if (!result.success) {
    logger.warn(TAG, "sendRandom fallo", result.reason);
    res.status(502).json({ success: false, error: "Error al enviar mensaje", message: result.reason });
    return;
  }

  logChatActivity(userId, channel, ip);
  res.status(200).json({ success: true, message: "Mensaje enviado correctamente" });
}
