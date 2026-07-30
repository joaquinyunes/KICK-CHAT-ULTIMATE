import { Router } from "express";
import path from "path";
import { rateLimit } from "express-rate-limit";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireFeature } from "../middleware/feature.middleware";
import { generateChat, getHistory, fetchNews, setUserApiKey, exportSimTxt, sendSimMessages, getSendStats, resetSendStats, buildPrompt } from "../controllers/stream-simulator.controller";

const router = Router();

const aiLimiter = rateLimit({ windowMs: 60_000, max: 30 });

router.get("/simulator", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "simulador.html"));
});
router.get("/simulador", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "simulador.html"));
});
router.get("/ajustes", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "ajustes.html"));
});
router.post("/api/chat/generate", requireAuth, requireFeature("simulator"), aiLimiter, generateChat);
router.get("/api/chat/history", requireAuth, requireFeature("simulator"), getHistory);
router.post("/api/chat/news", requireAuth, aiLimiter, fetchNews);
router.post("/api/chat/set-key", requireAuth, (req: Request, res: Response) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (!key) { res.status(400).json({ error: "key requerida" }); return; }
  setUserApiKey(key);
  res.json({ success: true });
});
router.post("/api/chat/export-txt", requireAuth, exportSimTxt);
router.post("/api/chat/send-sim", requireAuth, sendSimMessages);
router.get("/api/chat/send-stats", requireAuth, getSendStats);
router.post("/api/chat/send-stats/reset", requireAuth, resetSendStats);
router.post("/api/chat/build-prompt", requireAuth, buildPrompt);

export default router;
