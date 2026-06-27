import type { Request, Response, NextFunction } from "express";

export function requireFeature(feature: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "No autenticado" });
      return;
    }
    let permissions: string[] = [];
    try {
      permissions = JSON.parse(user.permissions || "[]");
    } catch {
      permissions = [];
    }
    if (!permissions.includes(feature)) {
      res.status(403).json({ error: `No tienes permiso para acceder a esta función: ${feature}` });
      return;
    }
    next();
  };
}
