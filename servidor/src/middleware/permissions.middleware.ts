import type { Request, Response, NextFunction } from "express";

export function requireFeature(...features: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) { res.status(401).json({ error: "No autenticado" }); return; }
      const userPermissions: string[] = JSON.parse(req.user.permissions || "[]");
      const hasAny = features.some(f => userPermissions.includes(f));
      if (!hasAny) {
        res.status(403).json({ error: `No tienes permiso para esta función. Requerido: ${features.join(" o ")}` });
        return;
      }
      next();
    } catch {
      res.status(403).json({ error: "Error al verificar permisos" });
    }
  };
}
