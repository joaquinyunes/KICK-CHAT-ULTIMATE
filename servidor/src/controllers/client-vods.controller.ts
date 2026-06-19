import type { Request, Response } from "express";
import { stmts } from "../models/database";
import { startViewer, stopViewer, getViewerStatus, getViewStats } from "../services/vod-viewer.service";

export function handleListVods(req: Request, res: Response): void {
  const userId = Number(req.user!.sub);
  const vods = stmts.listClientVods.all([userId]);
  res.json({ success: true, vods });
}

export function handleAddVod(req: Request, res: Response): void {
  const userId = Number(req.user!.sub);
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url es requerida" }); return;
  }
  // Parse type from URL
  let type = "vod";
  let channel: string | null = null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // kick.com/{channel}/videos/{id}  or  kick.com/{channel}/clips/{id}
    if (parts.length >= 2) {
      channel = parts[0];
      if (parts[1] === "clips") type = "clip";
    }
  } catch { /* invalid URL, still allow it */ }

  const result = stmts.insertClientVod.run([userId, url, type, channel]);
  res.status(201).json({ success: true, id: result.lastInsertRowid, type, channel });
}

export function handleDeleteVod(req: Request, res: Response): void {
  const userId = Number(req.user!.sub);
  const vodId = parseInt(req.params.id, 10);
  if (isNaN(vodId)) { res.status(400).json({ error: "id inválido" }); return; }
  const vod = stmts.findClientVodById.get([vodId]);
  if (!vod || vod.user_id !== userId) {
    res.status(404).json({ error: "VOD no encontrado" }); return;
  }
  stmts.deleteClientVod.run([vodId, userId]);
  res.json({ success: true, id: vodId });
}

export function handleStartViewer(req: Request, res: Response): void {
  const userId = Number(req.user!.sub);
  const result = startViewer(userId);
  if (result.success) {
    res.json({ success: true, message: "Visor iniciado" });
  } else {
    res.status(400).json({ error: result.error || "Error al iniciar visor" });
  }
}

export function handleStopViewer(req: Request, res: Response): void {
  const userId = Number(req.user!.sub);
  const result = stopViewer(userId);
  if (result.success) {
    res.json({ success: true, message: "Visor detenido" });
  } else {
    res.status(400).json({ error: result.error || "Error al detener visor" });
  }
}

export function handleViewerStats(req: Request, res: Response): void {
  const userId = Number(req.user!.sub);
  const viewerStatus = getViewerStatus(userId);
  const dbStats = getViewStats(userId);
  const user = stmts.findUserById.get([userId]);
  res.json({
    success: true,
    viewer: viewerStatus,
    stats: dbStats,
    hourly_limit: user?.hourly_view_limit ?? 50,
  });
}
