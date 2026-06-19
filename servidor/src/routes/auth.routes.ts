import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { handleRegister, handleLogin, handleMe, handleLogout, handleSyncCookie } from "../controllers/auth.controller";

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/register", requireAuth, requireAdmin, authLimiter, handleRegister);
router.post("/login", authLimiter, handleLogin);
router.get("/me", requireAuth, handleMe);
router.post("/logout", handleLogout);
router.post("/sync-cookie", requireAuth, handleSyncCookie);

export default router;
