import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireFeature } from "../middleware/feature.middleware";
import { handleChatSend, handleListMyBots } from "../controllers/chat.controller";
import { recordMessage } from "../telemetry";
import type { Request, Response } from "express";

const router = Router();

router.get("/me/bots", requireAuth, requireFeature("chat"), handleListMyBots);
router.get("/api/client/permissions", requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  let permissions: string[] = [];
  try { permissions = JSON.parse(user.permissions || '["chat","simulator","vods"]'); } catch { permissions = ["chat", "simulator", "vods"]; }
  res.json({ success: true, permissions, hourly_view_limit: user.hourly_view_limit ?? 50 });
});

router.post("/chat/send", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(500).json({ error: "Error de autenticación" });
  }
  console.log(`[CHAT/SEND] userId=${userId} channel=${req.body?.channel} msg="${(req.body?.message||'').substring(0,40)}"`);
  await handleChatSend(req, res);
  console.log(`[CHAT/SEND] result=${res.statusCode}`);
  if (res.statusCode === 200) {
    recordMessage();
  }
});

export default router;
