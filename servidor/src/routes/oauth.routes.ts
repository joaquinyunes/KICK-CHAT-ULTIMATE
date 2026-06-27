import { Router } from "express";
import { requireAuth } from "../middleware/jwt.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import { handleOAuthLogin, handleOAuthStart, handleOAuthCallback } from "../controllers/oauth.controller";

const router = Router();

router.get("/auth/kick/login", requireAuth, requireAdmin, handleOAuthLogin);
router.post("/auth/kick/start", requireAuth, requireAdmin, handleOAuthStart);
router.get("/auth/kick/callback", handleOAuthCallback);

export default router;
