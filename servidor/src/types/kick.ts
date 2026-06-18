export class KickApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message?: string
  ) {
    super(message || `Kick API error ${status}: ${body.slice(0, 200)}`);
    this.name = "KickApiError";
  }
}

export interface TokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface KickChannelInfo {
  broadcaster_user_id: number;
  slug: string;
  stream_title?: string;
  is_live?: boolean;
}

export interface KickUserInfo {
  user_id: number;
  name: string;
  profile_picture?: string;
  email?: string;
}

export interface ChatSendPayload {
  content: string;
  type: "user" | "bot";
  broadcaster_user_id?: number;
}

export interface ChatSendResult {
  ok: boolean;
  status: number;
  body?: string;
}

export interface SendMessageOptions {
  message: string;
  useBot?: boolean;
  fallback?: boolean;
}

export interface ReplyToMessageOptions extends SendMessageOptions {
  replyId: string;
}
