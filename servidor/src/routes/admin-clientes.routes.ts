import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { adminCreateUser, adminListUsers, adminUsersWithBots, adminUpdateUser, adminDeleteUser } from "../controllers/admin-clientes.controller";

const router = Router();

router.post("/api/admin/users", requireAuth, requireAdmin, adminCreateUser);
router.get("/api/admin/users", requireAuth, requireAdmin, adminListUsers);
router.get("/api/admin/users/with-bots", requireAuth, requireAdmin, adminUsersWithBots);
router.put("/api/admin/users/:userId", requireAuth, requireAdmin, adminUpdateUser);
router.delete("/api/admin/users/:userId", requireAuth, requireAdmin, adminDeleteUser);

export default router;
