import type { Request, Response } from "express";
import { stmts } from "../models/database";
import { encryptToHex } from "../services/security";

function audit(adminId: number, action: string, targetType: string | null, targetId: string | null, details: string | null, ip: string | null): void {
  try { stmts.insertAuditLog.run([adminId, action, targetType, targetId, details, ip]); } catch {}
}

export function adminCreateBot(req: Request, res: Response): void {
  const { bot_name, bearer } = req.body;
  if (!bot_name || typeof bot_name !== "string") {
    res.status(400).json({ error: "bot_name es requerido" }); return;
  }
  if (!bearer || typeof bearer !== "string") {
    res.status(400).json({ error: "bearer es requerido" }); return;
  }
  const existing = stmts.findBotByName.get(bot_name);
  if (existing) {
    res.status(409).json({ error: `El bot '${bot_name}' ya existe` }); return;
  }
  const encrypted = encryptToHex(bearer);
  const result = stmts.insertBot.run([bot_name, encrypted]);
  audit(Number(req.user!.sub), "create_bot", "bot", String(result.lastInsertRowid), bot_name, req.ip ?? null);
  res.status(201).json({ success: true, botId: result.lastInsertRowid, bot_name });
}

export function adminListBots(_req: Request, res: Response): void {
  const bots = stmts.listAllBots.all().map((b) => ({
    id: b.id, bot_name: b.bot_name, is_active: b.is_active, created_at: b.created_at,
    has_oauth: !!b.oauth_refresh_token, has_bearer: !!b.encrypted_bearer,
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
