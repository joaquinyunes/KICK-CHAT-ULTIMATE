import type { Request, Response } from "express";
import { stmts } from "../models/database";

function audit(adminId: number, action: string, targetType: string | null, targetId: string | null, details: string | null, ip: string | null): void {
  try { stmts.insertAuditLog.run([adminId, action, targetType, targetId, details, ip]); } catch {}
}

export function adminCreatePool(req: Request, res: Response): void {
  const { name, messages } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name es requerido" }); return;
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages debe ser un array con al menos un mensaje" }); return;
  }
  const existing = stmts.findPoolById.get(name);
  if (existing) {
    res.status(409).json({ error: `El pool '${name}' ya existe` }); return;
  }
  const result = stmts.insertPool.run([name, JSON.stringify(messages)]);
  audit(Number(req.user!.sub), "create_pool", "pool", String(result.lastInsertRowid), name, req.ip ?? null);
  res.status(201).json({ success: true, id: result.lastInsertRowid, name });
}

export function adminListPools(_req: Request, res: Response): void {
  const pools = stmts.listPools.all().map((p) => ({
    id: p.id, name: p.name, message_count: JSON.parse(p.messages || "[]").length,
  }));
  res.json({ success: true, pools });
}

export function adminDeletePool(req: Request, res: Response): void {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "id invalido" }); return; }
  stmts.deletePool.run([id]);
  audit(Number(req.user!.sub), "delete_pool", "pool", String(id), null, req.ip ?? null);
  res.json({ success: true });
}
