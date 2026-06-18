import { Router } from "express";
import path from "path";
import type { Request, Response } from "express";
import { generateChat, getHistory, fetchNews } from "../controllers/stream-simulator.controller";

const router = Router();

router.get("/simulator", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "stream-simulator.html"));
});
router.post("/api/chat/generate", generateChat);
router.get("/api/chat/history", getHistory);
router.post("/api/chat/news", fetchNews);

export default router;
