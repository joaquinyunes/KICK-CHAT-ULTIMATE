import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { handleChatSend, handleListMyBots } from "../controllers/chat.controller";
import { RateLimiter } from "../middleware/rate-limiter";
import { recordMessage } from "../telemetry";
import type { Request, Response } from "express";

const router = Router();

router.get("/me/bots", requireAuth, handleListMyBots);

router.post("/chat/send", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) {
    return res.status(500).json({ error: "Error de autenticación" });
  }
  if (!RateLimiter.canSend(userId)) {
    const wait = RateLimiter.secondsUntilNext(userId);
    return res.status(429).json({ error: "Rate limit alcanzado.", retryAfterSeconds: wait });
  }
  await handleChatSend(req, res);
  if (res.statusCode === 200) {
    RateLimiter.recordSend(userId);
    recordMessage();
  }
});

router.delete("/session/:sessionId", requireAuth, (req: Request, res: Response) => {
  RateLimiter.clearSession(req.params.sessionId);
  res.status(200).json({ success: true, message: "Sesión cerrada" });
});

export default router;
