import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { stmts } from "../models/database";
import { encryptToHex } from "../services/security";

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
  const { username, password } = req.body;

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
  const result = stmts.insertUserWithRole.run({
    username,
    password_hash: passwordHash,
    role: "client",
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
