import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/auth-manager";

export function requirePageAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.cookies?.scb_jwt;
  if (!token) {
    return res.redirect("/");
  }
  try {
    req.user = verifyToken(token);
    if (req.user.role !== "admin") {
      return res.redirect("/");
    }
    next();
  } catch {
    return res.redirect("/");
  }
}
