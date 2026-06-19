import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../services/auth-manager";

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  if (req.cookies?.scb_jwt) {
    return req.cookies.scb_jwt;
  }
  return null;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({
      error: "No autorizado",
      message: "Se requiere autenticación",
    });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    res.status(401).json({
      error:   "No autorizado",
      message: (err as Error).message,
    });
  }
}