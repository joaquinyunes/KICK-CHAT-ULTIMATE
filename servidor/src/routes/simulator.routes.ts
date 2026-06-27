import { Router } from "express";
import path from "path";
import { rateLimit } from "express-rate-limit";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireFeature } from "../middleware/feature.middleware";
import { generateChat, getHistory, fetchNews } from "../controllers/stream-simulator.controller";

const router = Router();

const aiLimiter = rateLimit({ windowMs: 60_000, max: 30 });

router.get("/simulator", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "stream-simulator.html"));
});
router.post("/api/chat/generate", requireAuth, requireFeature("simulator"), aiLimiter, generateChat);
router.get("/api/chat/history", requireAuth, requireFeature("simulator"), getHistory);
router.post("/api/chat/news", requireAuth, aiLimiter, fetchNews);

export default router;
