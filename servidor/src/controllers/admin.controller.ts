import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { stmts, getDb } from "../models/database";
import { encryptToHex } from "../services/security";
import { getSnapshot } from "../telemetry";

// ─── Bots ────────────────────────────────────────────────────────────────────

export function adminCreateBot(req: Request, res: Response): void {
  const { bot_name, bearer } = req.body;

  if (!bot_name || typeof bot_name !== "string") {
    res.status(400).json({ error: "bot_name es requerido" });
    return;
  }
  if (!bearer || typeof bearer !== "string") {
    res.status(400).json({ error: "bearer es requerido" });
    return;
  }

  const existing = stmts.findBotByName.get(bot_name);
  if (existing) {
    res.status(409).json({ error: `El bot '${bot_name}' ya existe` });
    return;
  }

  const encrypted = encryptToHex(bearer);
  const result = stmts.insertBot.run({ bot_name, encrypted_bearer: encrypted });

  res.status(201).json({ success: true, botId: result.lastInsertRowid, bot_name });
}

export function adminListBots(_req: Request, res: Response): void {
  const bots = stmts.listAllBots.all();
  res.json({ success: true, bots });
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

export function adminCreateUser(req: Request, res: Response): void {
  const { username, password, link_url, expires_at } = req.body;

  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username es requerido" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "password debe tener al menos 6 caracteres" });
    return;
  }

  const existing = stmts.findUserByUsernameExact.get(username);
  if (existing) {
    res.status(409).json({ error: `El usuario '${username}' ya existe` });
    return;
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const link = typeof link_url === "string" ? link_url : null;
  const expires = typeof expires_at === "number" ? expires_at : null;

  const result = stmts.insertUserFull.run({
    username,
    password_hash: passwordHash,
    role: "client",
    link_url: link,
    expires_at: expires,
  });

  res.status(201).json({ success: true, userId: result.lastInsertRowid, username, role: "client" });
}

export function adminListUsers(_req: Request, res: Response): void {
  const users = stmts.listAllUsers.all();
  res.json({ success: true, users });
}

// ─── Asignaciones ─────────────────────────────────────────────────────────────

export function adminAssignBot(req: Request, res: Response): void {
  const { bot_id, username } = req.body;

  if (!bot_id || typeof bot_id !== "number") {
    res.status(400).json({ error: "bot_id (number) es requerido" });
    return;
  }
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username es requerido" });
    return;
  }

  const bot = stmts.listAllBots.all().find((b) => b.id === bot_id);
  if (!bot) {
    res.status(404).json({ error: "Bot no encontrado" });
    return;
  }

  const user = stmts.findUserByUsernameExact.get(username);
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  stmts.assignBotToUser.run({ bot_id, user_id: user.id });

  res.json({ success: true, bot_name: bot.bot_name, username });
}

export function adminGetAssignments(req: Request, res: Response): void {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "userId inválido" });
    return;
  }

  const bots = stmts.listBotsForUser.all(userId);
  res.json({ success: true, userId, bots });
}

export function adminUnassignBot(req: Request, res: Response): void {
  const { bot_id, username } = req.body;
  if (!bot_id || typeof bot_id !== "number") {
    res.status(400).json({ error: "bot_id (number) es requerido" });
    return;
  }
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username es requerido" });
    return;
  }
  const user = stmts.findUserByUsernameExact.get(username);
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  stmts.unassignBotFromUser.run({ q_bot_id: bot_id, q_user_id: user.id });
  res.json({ success: true, bot_id, username });
}

export function adminUsersWithBots(_req: Request, res: Response): void {
  const users = stmts.listAllUsers.all();
  const result = users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    is_active: u.is_active,
    created_at: u.created_at,
    link_url: u.link_url,
    expires_at: u.expires_at,
    bots: stmts.listBotsForUser.all(u.id).map(b => ({ id: b.id, bot_name: b.bot_name })),
  }));
  res.json({ success: true, users: result });
}

export function adminUpdateUser(req: Request, res: Response): void {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "userId inválido" });
    return;
  }

  const user = stmts.findUserById.get([userId]);
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (user.role === "admin") {
    res.status(403).json({ error: "No se puede modificar el admin" });
    return;
  }

  const { link_url, expires_at, is_active } = req.body;
  const link = typeof link_url === "string" ? link_url : user.link_url;
  const expires = typeof expires_at === "number" ? expires_at : user.expires_at;
  const active = typeof is_active === "number" ? is_active : user.is_active;

  stmts.updateUser.run({ q_link: link, q_expires: expires, q_active: active, q_id: userId });
  res.json({ success: true, userId });
}

export function adminDeleteUser(req: Request, res: Response): void {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "userId inválido" });
    return;
  }

  const user = stmts.findUserById.get([userId]);
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }
  if (user.role === "admin") {
    res.status(403).json({ error: "No se puede eliminar el admin" });
    return;
  }

  stmts.deleteUser.run({ q_id: userId });
  res.json({ success: true, userId });
}

export function adminDashboard(_req: Request, res: Response): void {
  const allBots = stmts.listAllBots.all();
  const allUsers = stmts.listAllUsers.all();
  const clientUsers = allUsers.filter(u => u.role === "client");
  const snapshot = getSnapshot();

  const recentMessages = stmts.getRecentMessages.all([20]);

  const now = Math.floor(Date.now() / 1000);
  const expiredUsers = clientUsers.filter(u => u.expires_at && u.expires_at < now);

  res.json({
    success: true,
    stats: {
      total_bots: allBots.length,
      oauth_bots: allBots.filter(b => b.oauth_refresh_token).length,
      total_clients: clientUsers.length,
      active_clients: clientUsers.filter(u => u.is_active && (!u.expires_at || u.expires_at > now)).length,
      expired_clients: expiredUsers.length,
      messages_sent: snapshot.messages.total,
      uptime_seconds: snapshot.uptime.uptimeSeconds,
    },
    recent_messages: recentMessages,
  });
}
