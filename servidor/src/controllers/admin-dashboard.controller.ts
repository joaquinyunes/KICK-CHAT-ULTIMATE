import type { Request, Response } from "express";
import { stmts } from "../models/database";
import { getSnapshot } from "../telemetry";

export function adminDashboard(_req: Request, res: Response): void {
  const allBots = stmts.listAllBots.all();
  const allUsers = stmts.listAllUsers.all();
  const clientUsers = allUsers.filter(u => u.role === "client");
  const snapshot = getSnapshot();
  const recentMessages = stmts.getRecentMessages.all([20]);
  const now = Math.floor(Date.now() / 1000);
  const expiredUsers = clientUsers.filter(u => u.expires_at && u.expires_at < now);
  const allProxies = stmts.listProxies.all();

  res.json({
    success: true,
    stats: {
      total_bots: allBots.length,
      oauth_bots: allBots.filter(b => b.oauth_refresh_token).length,
      total_clients: clientUsers.length,
      active_clients: clientUsers.filter(u => u.is_active && (!u.expires_at || u.expires_at > now)).length,
      expired_clients: expiredUsers.length,
      messages_sent: snapshot.messages.total,
      uptime_seconds: snapshot.uptime.uptimeSeconds,
      total_proxies: allProxies.length,
      active_proxies: allProxies.filter(p => p.is_active).length,
    },
    recent_messages: recentMessages,
  });
}
