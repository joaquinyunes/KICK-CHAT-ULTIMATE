import crypto from "crypto";
import { env } from "../config/env";
import { stmts } from "../models/database";

const TOKEN_URL = "https://id.kick.com/oauth/token";
const API_CHAT_URL = "https://api.kick.com/public/v1/chat";
const AUTH_URL = "https://id.kick.com/oauth/authorize";

// ── PKCE ──────────────────────────────────────────────
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function getAuthorizationUrl(state: string, verifier: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.KICK_CLIENT_ID,
    redirect_uri: env.KICK_REDIRECT_URI,
    scope: "chat:write",
    state,
    code_challenge: generateCodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ── Token exchange ────────────────────────────────────
export async function exchangeCode(code: string, verifier: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      redirect_uri: env.KICK_REDIRECT_URI,
      code_verifier: verifier,
      code,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Refresh token ─────────────────────────────────────
export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      refresh_token: refreshToken,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Get valid access token for a bot ──────────────────
export async function getBotAccessToken(botId: number): Promise<string | null> {
  const bot = stmts.findBotById?.get([botId]) as any;
  if (!bot?.oauth_refresh_token) return null;

  // Check if current token is still valid
  if (bot.oauth_access_token && bot.oauth_token_expires_at > Math.floor(Date.now() / 1000)) {
    return bot.oauth_access_token;
  }

  // Refresh
  const result = await refreshAccessToken(bot.oauth_refresh_token);
  if (!result) return null;

  stmts.updateBotOAuthTokens.run({
    q_refresh: result.refresh_token || bot.oauth_refresh_token,
    q_access: result.access_token,
    q_expires: Math.floor(Date.now() / 1000) + result.expires_in,
    q_id: botId,
  });

  return result.access_token;
}

// ── Send message via official Kick API ────────────────
export async function sendViaOfficialApi(accessToken: string, content: string): Promise<{ ok: boolean; status: number; body?: string }> {
  try {
    const res = await fetch(API_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ content, type: "bot" }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err: any) {
    return { ok: false, status: 0, body: err.message };
  }
}
