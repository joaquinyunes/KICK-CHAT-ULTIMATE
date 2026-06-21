import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { adminCreatePool, adminListPools, adminDeletePool } from "../controllers/admin-pools.controller";

const router = Router();
router.post("/api/admin/pools", requireAuth, requireAdmin, adminCreatePool);
router.get("/api/admin/pools", requireAuth, requireAdmin, adminListPools);
router.delete("/api/admin/pools/:id", requireAuth, requireAdmin, adminDeletePool);
export default router;
