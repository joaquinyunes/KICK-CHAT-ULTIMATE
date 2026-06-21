import type { Request, Response } from "express";
import { stmts } from "../models/database";
import { encryptToHex } from "../services/security";

function audit(adminId: number, action: string, targetType: string | null, targetId: string | null, details: string | null, ip: string | null): void {
  try { stmts.insertAuditLog.run([adminId, action, targetType, targetId, details, ip]); } catch {}
}

export function adminCreateBot(req: Request, res: Response): void {
  let { bearer } = req.body;
  if (!bearer || typeof bearer !== "string") {
    res.status(400).json({ error: "bearer es requerido" }); return;
  }
  // Strip "Bearer " prefix if the user pasted the full header
  bearer = bearer.replace(/^Bearer\s+/i, "");
  const count = stmts.listAllBots.all().length;
  const botName = "bot" + (count + 1);
  const encrypted = encryptToHex(bearer);
  const result = stmts.insertBot.run([botName, encrypted]);
  audit(Number(req.user!.sub), "create_bot", "bot", String(result.lastInsertRowid), botName, req.ip ?? null);
  res.status(201).json({ success: true, botId: result.lastInsertRowid, bot_name: botName });
}

export function adminListBots(_req: Request, res: Response): void {
  const bots = stmts.listAllBots.all().map((b) => ({
    id: b.id, bot_name: b.bot_name, is_active: b.is_active, created_at: b.created_at,
    has_bearer: !!b.encrypted_bearer,
  }));
  res.json({ success: true, bots });
}

export function adminAssignBot(req: Request, res: Response): void {
  const { bot_id, username } = req.body;
  if (!bot_id || typeof bot_id !== "number") {
    res.status(400).json({ error: "bot_id (number) es requerido" }); return;
  }
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username es requerido" }); return;
  }
  const bot = stmts.listAllBots.all().find((b) => b.id === bot_id);
  if (!bot) { res.status(404).json({ error: "Bot no encontrado" }); return; }
  const user = stmts.findUserByUsernameExact.get(username);
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  stmts.assignBotToUser.run([bot_id, user.id]);
  audit(Number(req.user!.sub), "assign_bot", "bot", String(bot_id), `bot=${bot.bot_name} user=${username}`, req.ip ?? null);
  res.json({ success: true, bot_name: bot.bot_name, username });
}

export function adminGetAssignments(req: Request, res: Response): void {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }
  const bots = stmts.listBotsForUser.all(userId);
  res.json({ success: true, userId, bots });
}

export function adminUnassignBot(req: Request, res: Response): void {
  const { bot_id, username } = req.body;
  if (!bot_id || typeof bot_id !== "number") {
    res.status(400).json({ error: "bot_id (number) es requerido" }); return;
  }
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username es requerido" }); return;
  }
  const user = stmts.findUserByUsernameExact.get(username);
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  stmts.unassignBotFromUser.run([bot_id, user.id]);
  audit(Number(req.user!.sub), "unassign_bot", "bot", String(bot_id), `user=${username}`, req.ip ?? null);
  res.json({ success: true, bot_id, username });
}

export function adminUpdateBotCookies(req: Request, res: Response): void {
  const botId = parseInt(req.params.id, 10);
  if (isNaN(botId)) { res.status(400).json({ error: "id invalido" }); return; }
  const bot = stmts.findBotById.get([botId]);
  if (!bot) { res.status(404).json({ error: "Bot no encontrado" }); return; }
  const { cookies } = req.body;
  if (cookies !== undefined && typeof cookies !== "string") {
    res.status(400).json({ error: "cookies debe ser un string JSON" }); return;
  }
  stmts.updateBotCookies.run([cookies || null, botId]);
  audit(Number(req.user!.sub), "update_bot_cookies", "bot", String(botId), `bot=${bot.bot_name}`, req.ip ?? null);
  res.json({ success: true });
}
