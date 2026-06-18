import crypto from "crypto";
import type { Request, Response } from "express";
import { stmts } from "../models/database";
import { logger } from "../utils/logger";
import { getRegisteredTypes } from "../services/action-executor";
import { TriggerSource, TriggerEvent } from "../types/triggers";

const TAG = "actions";

// ─── Triggers ──────────────────────────────────────────────────

export function listTriggers(_req: Request, res: Response): void {
  try {
    const rows = (stmts as any).listTriggers?.all() || [];
    res.json({ success: true, triggers: rows });
  } catch (err: any) {
    logger.error(TAG, "listTriggers error", err.message);
    res.status(500).json({ error: "Error al listar triggers" });
  }
}

export function createTrigger(req: Request, res: Response): void {
  try {
    const { name, source, event, filters, action_ids } = req.body;
    if (!name || !source || !event) {
      res.status(400).json({ error: "name, source, event son requeridos" });
      return;
    }
    const id = crypto.randomUUID();
    (stmts as any).insertTrigger?.run([
      id, name, 1, source, event,
      filters ? JSON.stringify(filters) : null,
      JSON.stringify(action_ids || []),
      Math.floor(Date.now() / 1000),
    ]);
    res.status(201).json({ success: true, id });
  } catch (err: any) {
    logger.error(TAG, "createTrigger error", err.message);
    res.status(500).json({ error: "Error al crear trigger" });
  }
}

export function updateTrigger(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    const { name, enabled, source, event, filters, action_ids } = req.body;
    if (!id) { res.status(400).json({ error: "id requerido" }); return; }
    (stmts as any).updateTrigger?.run([
      name, enabled !== undefined ? (enabled ? 1 : 0) : undefined,
      source, event,
      filters ? JSON.stringify(filters) : null,
      JSON.stringify(action_ids || []),
      id,
    ]);
    res.json({ success: true });
  } catch (err: any) {
    logger.error(TAG, "updateTrigger error", err.message);
    res.status(500).json({ error: "Error al actualizar trigger" });
  }
}

export function deleteTrigger(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    if (!id) { res.status(400).json({ error: "id requerido" }); return; }
    (stmts as any).deleteTrigger?.run([id]);
    res.json({ success: true });
  } catch (err: any) {
    logger.error(TAG, "deleteTrigger error", err.message);
    res.status(500).json({ error: "Error al eliminar trigger" });
  }
}

// ─── Actions ────────────────────────────────────────────────────

export function listActions(_req: Request, res: Response): void {
  try {
    const rows = (stmts as any).listActions?.all() || [];
    res.json({ success: true, actions: rows });
  } catch (err: any) {
    logger.error(TAG, "listActions error", err.message);
    res.status(500).json({ error: "Error al listar actions" });
  }
}

export function createAction(req: Request, res: Response): void {
  try {
    const { name, steps } = req.body;
    if (!name) { res.status(400).json({ error: "name requerido" }); return; }
    const id = crypto.randomUUID();
    (stmts as any).insertAction?.run([id, name, 1, Math.floor(Date.now() / 1000)]);

    if (Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepId = crypto.randomUUID();
        (stmts as any).insertStep?.run([
          stepId, id, step.type, i,
          JSON.stringify(step.params || {}), 1,
        ]);
      }
    }

    res.status(201).json({ success: true, id });
  } catch (err: any) {
    logger.error(TAG, "createAction error", err.message);
    res.status(500).json({ error: "Error al crear action" });
  }
}

export function getAction(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    const row = (stmts as any).findAction?.get([id]);
    if (!row) { res.status(404).json({ error: "Action no encontrada" }); return; }
    const steps = (stmts as any).listStepsForAction?.all([id]) || [];
    res.json({ success: true, action: { ...row, steps } });
  } catch (err: any) {
    logger.error(TAG, "getAction error", err.message);
    res.status(500).json({ error: "Error al obtener action" });
  }
}

export function deleteAction(req: Request, res: Response): void {
  try {
    const { id } = req.params;
    if (!id) { res.status(400).json({ error: "id requerido" }); return; }
    (stmts as any).deleteStepsForAction?.run([id]);
    (stmts as any).deleteAction?.run([id]);
    res.json({ success: true });
  } catch (err: any) {
    logger.error(TAG, "deleteAction error", err.message);
    res.status(500).json({ error: "Error al eliminar action" });
  }
}

// ─── Info ───────────────────────────────────────────────────────

export function getActionTypes(_req: Request, res: Response): void {
  res.json({
    success: true,
    sources: Object.values(TriggerSource),
    events: Object.values(TriggerEvent),
    subActionTypes: getRegisteredTypes(),
  });
}
