import type { Request, Response } from "express";
import { getAllProxies, getProxyById, createProxy, updateProxy, deleteProxy, bulkImportProxies } from "../services/proxy-manager.service";
import { stmts } from "../models/database";

function audit(adminId: number, action: string, targetId: string | null, details: string | null): void {
  try { stmts.insertAuditLog.run([adminId, action, "proxy", targetId, details, null]); } catch {}
}

export function handleListProxies(_req: Request, res: Response): void {
  const proxies = getAllProxies();
  res.json({ success: true, proxies });
}

export function handleCreateProxy(req: Request, res: Response): void {
  const { host, port, username, password, protocol, is_active } = req.body;
  if (!host || !port || !username || !password) {
    res.status(400).json({ error: "host, port, username, password son requeridos" }); return;
  }
  const result = createProxy({ host, port: Number(port), username, password, protocol, is_active });
  audit(Number(req.user!.sub), "create_proxy", String(result.id), `${host}:${port}`);
  res.status(201).json({ success: true, id: result.id });
}

export function handleUpdateProxy(req: Request, res: Response): void {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const existing = getProxyById(id);
  if (!existing) { res.status(404).json({ error: "Proxy no encontrado" }); return; }
  const { host, port, username, password, protocol, is_active } = req.body;
  updateProxy(id, { host, port: port ? Number(port) : undefined, username, password, protocol, is_active });
  audit(Number(req.user!.sub), "update_proxy", String(id), JSON.stringify(req.body));
  res.json({ success: true, id });
}

export function handleDeleteProxy(req: Request, res: Response): void {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "id inválido" }); return; }
  const existing = getProxyById(id);
  if (!existing) { res.status(404).json({ error: "Proxy no encontrado" }); return; }
  deleteProxy(id);
  audit(Number(req.user!.sub), "delete_proxy", String(id), `${existing.host}:${existing.port}`);
  res.json({ success: true, id });
}

export function handleImportProxies(req: Request, res: Response): void {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text es requerido (formato user:pass@host:port por línea)" }); return;
  }
  const count = bulkImportProxies(text);
  audit(Number(req.user!.sub), "import_proxies", null, `${count} proxies importados`);
  res.json({ success: true, imported: count });
}
