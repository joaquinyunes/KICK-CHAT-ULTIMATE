import type { TriggerContext } from "./triggers";

export enum SubActionType {
  KickSendMessage = "kick.chat.send_message",
  KickReplyToMessage = "kick.chat.reply_to_message",
  KickBanUser = "kick.moderation.ban_user",
  KickSetChannelTitle = "kick.channel.set_title",
  LogMessage = "core.log_message",
  HttpRequest = "core.http_request",
  Delay = "core.delay",
  Condition = "core.condition",
}

export interface SubActionStep {
  id: string;
  actionId: string; // parent action
  type: SubActionType;
  order: number;
  /** Parameters for the sub-action */
  params: Record<string, any>;
  enabled: boolean;
}

export interface ActionResult {
  success: boolean;
  stepId: string;
  type: SubActionType;
  error?: string;
  data?: any;
  durationMs: number;
}

export interface SubActionHandler {
  type: SubActionType;
  execute(params: Record<string, any>, context: TriggerContext): Promise<ActionResult>;
}

export interface Action {
  id: string;
  name: string;
  steps: SubActionStep[];
  enabled: boolean;
  created_at: number;
}
