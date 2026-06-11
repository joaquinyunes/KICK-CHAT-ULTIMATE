import type { Request, Response, NextFunction } from "express";

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ error: "No autorizado", message: "Token requerido" });
    return;
  }

  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Prohibido", message: "Se requieren permisos de administrador" });
    return;
  }

  next();
}
