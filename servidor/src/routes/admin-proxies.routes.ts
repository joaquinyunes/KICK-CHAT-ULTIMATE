import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { handleListProxies, handleCreateProxy, handleUpdateProxy, handleDeleteProxy, handleImportProxies } from "../controllers/admin-proxies.controller";

const router = Router();

router.get("/api/admin/proxies", requireAuth, requireAdmin, handleListProxies);
router.post("/api/admin/proxies", requireAuth, requireAdmin, handleCreateProxy);
router.put("/api/admin/proxies/:id", requireAuth, requireAdmin, handleUpdateProxy);
router.delete("/api/admin/proxies/:id", requireAuth, requireAdmin, handleDeleteProxy);
router.post("/api/admin/proxies/import", requireAuth, requireAdmin, handleImportProxies);

export default router;
