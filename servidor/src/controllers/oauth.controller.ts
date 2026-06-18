import type { Request, Response } from "express";
import crypto from "crypto";
import { stmts } from "../models/database";
import { getAuthorizationUrl, generateCodeVerifier, exchangeCode, getKickUsername } from "../services/kick-oauth";
import { logger } from "../utils/logger";
import { KickApiError } from "../types/kick";

const TAG = "oauth";

interface OAuthState { verifier: string; botId?: number; autoCreate?: boolean; userId?: number }
export const oauthStates = new Map<string, OAuthState>();

export function handleOAuthLogin(req: Request, res: Response) {
  const verifier = generateCodeVerifier();
  const state = crypto.randomBytes(16).toString("hex");
  const rawBotId = req.query.botId as string | undefined;
  if (rawBotId) {
    const botId = parseInt(rawBotId, 10);
    if (isNaN(botId)) { res.status(400).json({ error: "botId invalido" }); return; }
    const bot = stmts.findBotById.get([botId]);
    if (!bot) { res.status(404).json({ error: "Bot no encontrado" }); return; }
    oauthStates.set(state, { verifier, botId });
  } else {
    oauthStates.set(state, { verifier, autoCreate: true });
  }
  setTimeout(() => oauthStates.delete(state), 10 * 60_000);
  res.redirect(getAuthorizationUrl(state, verifier));
}

export function handleOAuthStart(req: Request, res: Response) {
  const verifier = generateCodeVerifier();
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.set(state, { verifier, autoCreate: true, userId: parseInt((req as any).user?.sub, 10) || undefined });
  setTimeout(() => oauthStates.delete(state), 10 * 60_000);
  res.json({ url: getAuthorizationUrl(state, verifier) });
}

export async function handleOAuthCallback(req: Request, res: Response) {
  const { code, state, error } = req.query as Record<string, string>;
  if (error || !code || !state) {
    return res.redirect("/admin/dashboard?oauth=error&reason=" + encodeURIComponent(error || "missing_params"));
  }
  const stored = oauthStates.get(state);
  if (!stored) {
    return res.redirect("/admin/dashboard?oauth=error&reason=state_expired");
  }
  oauthStates.delete(state);

  const result = await exchangeCode(code, stored.verifier);
  if (!result) {
    logger.error(TAG, "token_exchange_failed para state=" + state);
    return res.redirect("/admin/dashboard?oauth=error&reason=token_exchange_failed");
  }

  const kickUser = await getKickUsername(result.access_token);
  if (!kickUser) {
    return res.redirect("/admin/dashboard?oauth=error&reason=no_bot_name");
  }
  const botName = "bot." + kickUser;

  const assignToUser = (botId: number) => {
    if (stored.userId) {
      try { stmts.assignBotToUser.run([botId, stored.userId]); } catch {}
    }
  };

  if (stored.botId) {
    stmts.updateBotOAuthTokens.run([result.refresh_token, result.access_token, Math.floor(Date.now() / 1000) + result.expires_in, stored.botId]);
    assignToUser(stored.botId);
    return res.redirect("/admin/dashboard?oauth=success&botId=" + stored.botId);
  }

  const existing = stmts.findBotByName.get(botName);
  if (existing) {
    stmts.updateBotOAuthTokens.run([result.refresh_token, result.access_token, Math.floor(Date.now() / 1000) + result.expires_in, existing.id]);
    assignToUser(existing.id);
    return res.redirect("/admin/dashboard?oauth=success&botId=" + existing.id);
  }

  const newBot = stmts.insertBot.run([botName, ""]);
  stmts.updateBotOAuthTokens.run([result.refresh_token, result.access_token, Math.floor(Date.now() / 1000) + result.expires_in, newBot.lastInsertRowid as number]);
  assignToUser(newBot.lastInsertRowid as number);
  res.redirect("/admin/dashboard?oauth=success&botId=" + newBot.lastInsertRowid);
}
