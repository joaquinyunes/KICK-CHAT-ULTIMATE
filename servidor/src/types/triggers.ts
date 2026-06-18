export enum TriggerSource {
  Kick = "kick",
  Twitch = "twitch",
  YouTube = "youtube",
  Custom = "custom",
}

export enum TriggerEvent {
  // Kick events
  KickChatMessage = "kick.chat.message",
  KickFollow = "kick.follow",
  KickSubscription = "kick.subscription",
  KickChannelPointReward = "kick.channel_point_reward",
  KickStreamOnline = "kick.stream.online",
  KickStreamOffline = "kick.stream.offline",

  // Generic
  Command = "command",
  Webhook = "webhook",
  Schedule = "schedule",
  Manual = "manual",
}

export interface TriggerContext {
  source: TriggerSource;
  event: TriggerEvent;
  /** Raw payload from the source */
  payload: Record<string, any>;
  /** Timestamp when the trigger fired */
  timestamp: number;
  /** Channel/source identifier (e.g. Kick channel slug) */
  channelId?: string;
  /** User who triggered the event */
  userId?: string | number;
  /** Username who triggered the event */
  userName?: string;
  /** Extracted command (if event is Command) */
  command?: string;
  /** Arguments after the command */
  args?: string[];
  /** Message ID (for reply actions) */
  messageId?: string;
  /** Pre-extracted message text */
  messageText?: string;
}

export interface TriggerRule {
  id: string;
  name: string;
  enabled: boolean;
  source: TriggerSource;
  event: TriggerEvent;
  /** Optional filter conditions (JSON) */
  filters?: Record<string, any>;
  /** IDs of actions to execute when triggered */
  actionIds: string[];
  created_at: number;
}
