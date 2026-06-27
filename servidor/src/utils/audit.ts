import { stmts } from "../models/database";

export function audit(adminId: number, action: string, targetType: string | null, targetId: string | null, details: string | null, ip: string | null): void {
  try { stmts.insertAuditLog.run([adminId, action, targetType, targetId, details, ip]); } catch {}
}
