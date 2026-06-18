import crypto from "crypto";
import { env } from "../config/env";
import { stmts } from "../models/database";
import { logger } from "../utils/logger";
import { KickApiError, type TokenResult } from "../types/kick";

const TAG = "kick-oauth";
const TOKEN_URL = "https://id.kick.com/oauth/token";
const API_CHAT_URL = "https://api.kick.com/public/v1/chat";
const API_CHANNELS_URL = "https://api.kick.com/public/v1/channels";
const API_USERS_URL = "https://api.kick.com/public/v1/users";
const AUTH_URL = "https://id.kick.com/oauth/authorize";
const USER_AGENT = "StreamChatBridge/1.0 (+https://github.com/)";

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
    scope: "chat:write user:read channel:read",
    state,
    code_challenge: generateCodeChallenge(verifier),
    code_challenge_method: "S256",
  });
  return AUTH_URL + "?" + params.toString();
}

function normalizeTokenResponse(raw: any): TokenResult {
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_in: Number(raw.expires_in) || 3600,
  };
}

async function kickFetch(url: string, options: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new KickApiError(res.status, body);
  }
  return res;
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResult | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      redirect_uri: env.KICK_REDIRECT_URI,
      code_verifier: verifier,
      code,
    });
    const res = await kickFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return normalizeTokenResponse(await res.json());
  } catch (err: any) {
    if (err instanceof KickApiError) {
      logger.error(TAG, "exchangeCode fallo", err.status, err.body);
    } else {
      logger.error(TAG, "exchangeCode excepcion", err.message);
    }
    return null;
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResult | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      refresh_token: refreshToken,
    });
    const res = await kickFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return normalizeTokenResponse(await res.json());
  } catch (err: any) {
    if (err instanceof KickApiError) {
      logger.error(TAG, "refreshAccessToken fallo", err.status, err.body);
    } else {
      logger.error(TAG, "refreshAccessToken excepcion", err.message);
    }
    return null;
  }
}

export async function getBotAccessToken(botId: number): Promise<string | null> {
  const bot = stmts.findBotById?.get([botId]) as any;
  if (!bot?.oauth_refresh_token) {
    logger.warn(TAG, "getBotAccessToken: bot " + botId + " sin refresh_token");
    return null;
  }

  const SAFETY_MARGIN = 60;
  if (bot.oauth_access_token && bot.oauth_token_expires_at > Math.floor(Date.now() / 1000) + SAFETY_MARGIN) {
    return bot.oauth_access_token;
  }

  const result = await refreshAccessToken(bot.oauth_refresh_token);
  if (!result) return null;

  stmts.updateBotOAuthTokens.run([
    result.refresh_token || bot.oauth_refresh_token,
    result.access_token,
    Math.floor(Date.now() / 1000) + result.expires_in,
    botId,
  ]);
  return result.access_token;
}

export async function getKickUsername(accessToken: string): Promise<string | null> {
  try {
    const res = await kickFetch(API_USERS_URL, {
      headers: { Authorization: "Bearer " + accessToken },
    });
    const data = await res.json();
    const user = Array.isArray(data?.data) ? data.data[0] : data?.data;
    return user?.name ?? null;
  } catch (err: any) {
    if (err instanceof KickApiError) {
      logger.error(TAG, "getKickUsername fallo", err.status, err.body);
    } else {
      logger.error(TAG, "getKickUsername excepcion", err.message);
    }
    return null;
  }
}

export async function getBroadcasterUserId(accessToken: string, slug: string): Promise<number | null> {
  try {
    const url = API_CHANNELS_URL + "?slug=" + encodeURIComponent(slug.trim().toLowerCase());
    const res = await kickFetch(url, {
      headers: { Authorization: "Bearer " + accessToken },
    });
    const data = await res.json();
    const channel = Array.isArray(data?.data) ? data.data[0] : data?.data;
    return channel?.broadcaster_user_id ?? null;
  } catch (err: any) {
    if (err instanceof KickApiError) {
      logger.error(TAG, "getBroadcasterUserId fallo", err.status, err.body);
    } else {
      logger.error(TAG, "getBroadcasterUserId excepcion", err.message);
    }
    return null;
  }
}

export async function sendViaOfficialApi(
  accessToken: string,
  content: string,
  broadcasterUserId?: number
): Promise<{ ok: boolean; status: number; body?: string }> {
  try {
    let safeContent = content;
    if (safeContent.length > 500) {
      logger.warn(TAG, "Mensaje truncado a 500 caracteres (limite de la API)");
      safeContent = safeContent.slice(0, 500);
    }

    const bodyPayload: any = {
      content: safeContent,
      type: broadcasterUserId != null ? "user" : "bot",
    };
    if (broadcasterUserId != null) bodyPayload.broadcaster_user_id = broadcasterUserId;

    const res = await kickFetch(API_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(bodyPayload),
    });
    const body = await res.text();
    return { ok: true, status: res.status, body };
  } catch (err: any) {
    if (err instanceof KickApiError) {
      logger.error(TAG, "sendViaOfficialApi fallo", err.status, err.body);
      return { ok: false, status: err.status, body: err.body };
    }
    logger.error(TAG, "sendViaOfficialApi excepcion", err.message);
    return { ok: false, status: 0, body: err.message };
  }
}
