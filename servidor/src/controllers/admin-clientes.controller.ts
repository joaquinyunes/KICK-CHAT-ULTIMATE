import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { stmts } from "../models/database";

export function adminCreateUser(req: Request, res: Response): void {
  const { username, password, link_url, expires_at } = req.body;
  if (!username || typeof username !== "string") {
    res.status(400).json({ error: "username es requerido" }); return;
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "password debe tener al menos 6 caracteres" }); return;
  }
  const existing = stmts.findUserByUsernameExact.get(username);
  if (existing) { res.status(409).json({ error: `El usuario '${username}' ya existe` }); return; }
  const passwordHash = bcrypt.hashSync(password, 12);
  const link = typeof link_url === "string" ? link_url : null;
  const expires = typeof expires_at === "number" ? expires_at : null;
  const result = stmts.insertUserFull.run([username, passwordHash, "client", link, expires]);
  res.status(201).json({ success: true, userId: result.lastInsertRowid, username, role: "client" });
}

export function adminListUsers(_req: Request, res: Response): void {
  const users = stmts.listAllUsers.all();
  res.json({ success: true, users });
}

export function adminUsersWithBots(_req: Request, res: Response): void {
  const users = stmts.listAllUsers.all();
  const result = users.map(u => ({
    id: u.id, username: u.username, role: u.role, is_active: u.is_active,
    created_at: u.created_at, link_url: u.link_url, expires_at: u.expires_at,
    bots: stmts.listBotsForUser.all(u.id).map(b => ({ id: b.id, bot_name: b.bot_name })),
  }));
  res.json({ success: true, users: result });
}

export function adminUpdateUser(req: Request, res: Response): void {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }
  const user = stmts.findUserById.get([userId]);
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  if (user.role === "admin") { res.status(403).json({ error: "No se puede modificar el admin" }); return; }
  const { link_url, expires_at, is_active } = req.body;
  const link = typeof link_url === "string" ? link_url : user.link_url;
  const expires = typeof expires_at === "number" ? expires_at : user.expires_at;
  const active = typeof is_active === "number" ? is_active : user.is_active;
  stmts.updateUser.run([link, expires, active, userId]);
  res.json({ success: true, userId });
}

export function adminDeleteUser(req: Request, res: Response): void {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }
  const user = stmts.findUserById.get([userId]);
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
  if (user.role === "admin") { res.status(403).json({ error: "No se puede eliminar el admin" }); return; }
  stmts.deleteUser.run([userId]);
  res.json({ success: true, userId });
}
