import { logger } from "../../utils/logger";
import type { SubActionHandler, ActionResult } from "../../types/sub-actions";
import { SubActionType } from "../../types/sub-actions";
import type { TriggerContext } from "../../types/triggers";
import { sendMessage, replyToMessage } from "../chat-sender.service";

const TAG = "sub-kick";

async function resolveUserId(context: TriggerContext): Promise<number> {
  const raw = context.userId;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

export const KickSendMessageHandler: SubActionHandler = {
  type: SubActionType.KickSendMessage,
  async execute(params: Record<string, any>, context: TriggerContext): Promise<ActionResult> {
    const start = Date.now();
    try {
      const message = params.message || context.messageText || "";
      const useBot = params.useBot !== false;
      const fallback = params.fallback === true;
      const channel = params.channel || context.channelId || "";

      if (!message) {
        throw new Error("Message is required");
      }

      const result = await sendMessage({
        channel,
        message,
        userId: await resolveUserId(context),
      });

      return {
        success: result.success,
        stepId: "",
        type: SubActionType.KickSendMessage,
        error: result.reason,
        data: { timestamp: result.sentAt, status: result.status },
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      logger.error(TAG, "KickSendMessage fallo", err.message);
      return {
        success: false,
        stepId: "",
        type: SubActionType.KickSendMessage,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  },
};

export const KickReplyToMessageHandler: SubActionHandler = {
  type: SubActionType.KickReplyToMessage,
  async execute(params: Record<string, any>, context: TriggerContext): Promise<ActionResult> {
    const start = Date.now();
    try {
      const message = params.message || context.messageText || "";
      const replyId = params.replyId || context.messageId || "";
      const channel = params.channel || context.channelId || "";

      if (!message) throw new Error("Message is required");
      if (!replyId) throw new Error("replyId is required");

      const result = await replyToMessage({
        channel,
        message,
        replyId,
        userId: await resolveUserId(context),
      });

      return {
        success: result.success,
        stepId: "",
        type: SubActionType.KickReplyToMessage,
        error: result.reason,
        data: { timestamp: result.sentAt },
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      logger.error(TAG, "KickReplyToMessage fallo", err.message);
      return {
        success: false,
        stepId: "",
        type: SubActionType.KickReplyToMessage,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  },
};

export const kickChatHandlers: SubActionHandler[] = [
  KickSendMessageHandler,
  KickReplyToMessageHandler,
];
