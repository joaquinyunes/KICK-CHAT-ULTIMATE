import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { handleRegister, handleLogin } from "../controllers/auth.controller";

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/register", authLimiter, handleRegister);
router.post("/login", authLimiter, handleLogin);

export default router;
