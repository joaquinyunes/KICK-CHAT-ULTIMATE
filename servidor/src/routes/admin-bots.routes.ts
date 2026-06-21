import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { adminCreateBot, adminListBots, adminAssignBot, adminGetAssignments, adminUnassignBot, adminUpdateBotCookies } from "../controllers/admin-bots.controller";

const router = Router();

router.post("/api/admin/bots", requireAuth, requireAdmin, adminCreateBot);
router.get("/api/admin/bots", requireAuth, requireAdmin, adminListBots);
router.post("/api/admin/bots/assign", requireAuth, requireAdmin, adminAssignBot);
router.delete("/api/admin/bots/unassign", requireAuth, requireAdmin, adminUnassignBot);
router.get("/api/admin/bots/assignments/:userId", requireAuth, requireAdmin, adminGetAssignments);
router.put("/api/admin/bots/:id/cookies", requireAuth, requireAdmin, adminUpdateBotCookies);

export default router;
