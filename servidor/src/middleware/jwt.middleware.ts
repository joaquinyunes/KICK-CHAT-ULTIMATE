// middleware/jwt.middleware.ts - Validacion de JWT en rutas protegidas
/**
 * middleware/jwt.middleware.ts
 * Valida el JWT en las rutas protegidas.
 * Adjunta el payload decodificado en `req.user` para los controladores.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "../services/auth-manager";

// Extender el tipo de Request para incluir `user`
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "No autorizado",
      message: "Se requiere token de autenticación (Authorization: Bearer <token>)",
    });
    return;
  }

  const token = authHeader.slice(7); // remover "Bearer "

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({
      error:   "No autorizado",
      message: (err as Error).message,
    });
  }
}