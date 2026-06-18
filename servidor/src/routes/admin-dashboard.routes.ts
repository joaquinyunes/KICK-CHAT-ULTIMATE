import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { adminDashboard } from "../controllers/admin-dashboard.controller";

const router = Router();

router.get("/api/admin/dashboard", requireAuth, requireAdmin, adminDashboard);

export default router;
