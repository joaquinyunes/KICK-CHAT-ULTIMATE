import { Router, type Request, type Response } from "express";
import {
  getStatus, saveConfig, disconnectAccount, buildAuthUrl, exchangeCode,
  forceRefresh, sendAsUser, isPendingState, testAccount, testAllAccounts, DEFAULT_REDIRECT_URI,
} from "../services/kick20.service";
import { logger } from "../utils/logger";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";

/**
 * Rutas del módulo "kick20" — API para OAuth 2.1 oficial y envío de mensajes
 * vía api.kick.com/public/v1/chat como usuario. Multi-cuenta.
 * Solo admin (JWT por cookie o Bearer): la UI vive en /admin/kick20. Única excepción:
 * los callbacks OAuth, que los abre Kick en el navegador y se validan con `state`.
 */
const router = Router();
const TAG = "kick20";
const adminOnly = [requireAuth, requireAdmin];

router.get("/kick20/api/status", ...adminOnly, (_req: Request, res: Response) => {
  res.json(getStatus());
});

router.post("/kick20/api/config", ...adminOnly, (req: Request, res: Response) => {
  const { client_id, client_secret, redirect_uri } = req.body ?? {};
  if (!client_id || typeof client_id !== "string") { res.status(400).json({ error: "client_id requerido" }); return; }
  if (!client_secret || typeof client_secret !== "string") { res.status(400).json({ error: "client_secret requerido" }); return; }
  saveConfig(client_id, client_secret, typeof redirect_uri === "string" && redirect_uri ? redirect_uri : DEFAULT_REDIRECT_URI);
  res.json({ ok: true, status: getStatus() });
});

router.post("/kick20/api/disconnect", ...adminOnly, (req: Request, res: Response) => {
  const username = typeof req.body?.username === "string" ? req.body.username : undefined;
  disconnectAccount(username);
  res.json({ ok: true, status: getStatus() });
});

router.post("/kick20/api/refresh", ...adminOnly, async (req: Request, res: Response) => {
  const username = typeof req.body?.username === "string" ? req.body.username : undefined;
  const r = await forceRefresh(username);
  res.status(r.ok ? 200 : 400).json({ ...r, status: getStatus() });
});

// Prueba no destructiva (no envía mensajes). Sin `username` prueba todas las cuentas.
router.post("/kick20/api/test", ...adminOnly, async (req: Request, res: Response) => {
  const username = typeof req.body?.username === "string" ? req.body.username : undefined;
  const results = username ? [await testAccount(username)] : await testAllAccounts();
  res.json({
    ok: results.length > 0 && results.every((r) => r.ok),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    results,
    status: getStatus(),
  });
});

router.get("/kick20/api/auth-url", ...adminOnly, (_req: Request, res: Response) => {
  try {
    res.json({ url: buildAuthUrl() });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/kick20/connect", ...adminOnly, (_req: Request, res: Response) => {
  try {
    res.redirect(buildAuthUrl());
  } catch (e: any) {
    res.status(400).send("kick20: " + e.message + ". Configurá client_id/secret primero.");
  }
});

async function handleCallback(req: Request, res: Response) {
  const { code, state, error } = req.query as Record<string, string>;
  if (error || !code || !state) {
    return res.redirect("/admin/kick20?err=" + encodeURIComponent(error || "missing_params"));
  }
  const r = await exchangeCode(code, state);
  if (!r.ok) {
    logger.error(TAG, "callback fallo", r.error);
    return res.redirect("/admin/kick20?err=" + encodeURIComponent(r.error || "exchange_failed"));
  }
  res.redirect("/admin/kick20?ok=1&user=" + encodeURIComponent(r.username || ""));
}

router.get("/kick20/callback", handleCallback);

// Callback compartido: si la Kick App tiene registrado /auth/kick/callback
// (el redirect_uri clásico), interceptamos solo cuando el `state` es de kick20;
// si no, dejamos pasar al flujo OAuth original.
router.get("/auth/kick/callback", (req: Request, res: Response, next) => {
  const state = String((req.query as Record<string, string>).state || "");
  if (state && isPendingState(state)) return handleCallback(req, res);
  next();
});

router.post("/kick20/api/send", ...adminOnly, async (req: Request, res: Response) => {
  const { channel, content, reply_to_message_id, username } = req.body ?? {};
  if (!channel || typeof channel !== "string") { res.status(400).json({ error: "channel requerido" }); return; }
  if (!content || typeof content !== "string") { res.status(400).json({ error: "content requerido" }); return; }
  const r = await sendAsUser(channel, content, {
    username: typeof username === "string" ? username : undefined,
    replyToMessageId: typeof reply_to_message_id === "string" ? reply_to_message_id : undefined,
  });
  res.status(r.ok ? 200 : (r.status && r.status >= 400 ? r.status : 502)).json(r);
});

export default router;
