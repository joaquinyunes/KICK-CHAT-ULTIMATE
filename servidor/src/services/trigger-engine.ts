import { logger } from "../utils/logger";
import { stmts } from "../models/database";
import type { TriggerRule, TriggerContext } from "../types/triggers";
import { TriggerEvent, TriggerSource } from "../types/triggers";
import { executeAction } from "./action-executor";
import type { Action, SubActionStep } from "../types/sub-actions";

const TAG = "trigger";

interface StoredTrigger {
  id: string;
  name: string;
  enabled: number;
  source: string;
  event: string;
  filters: string | null;
  action_ids: string;
  created_at: number;
}

interface StoredAction {
  id: string;
  name: string;
  enabled: number;
  created_at: number;
}

interface StoredStep {
  id: string;
  action_id: string;
  type: string;
  order: number;
  params: string;
  enabled: number;
}

function loadTriggers(): TriggerRule[] {
  try {
    const rows = (stmts as any).listTriggers?.all() as StoredTrigger[] | undefined;
    if (!rows) return [];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled === 1,
      source: r.source as TriggerSource,
      event: r.event as TriggerEvent,
      filters: r.filters ? JSON.parse(r.filters) : undefined,
      actionIds: JSON.parse(r.action_ids),
      created_at: r.created_at,
    }));
  } catch {
    return [];
  }
}

function loadAction(actionId: string): Action | null {
  try {
    const row = (stmts as any).findAction?.get([actionId]) as StoredAction | undefined;
    if (!row) return null;
    const stepRows = (stmts as any).listStepsForAction?.all([actionId]) as StoredStep[] | undefined;
    const steps: SubActionStep[] = (stepRows || []).map((s) => ({
      id: s.id,
      actionId: s.action_id,
      type: s.type as any,
      order: s.order,
      params: JSON.parse(s.params || "{}"),
      enabled: s.enabled === 1,
    }));
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      steps,
      created_at: row.created_at,
    };
  } catch {
    return null;
  }
}

function matchesFilters(rule: TriggerRule, context: TriggerContext): boolean {
  if (!rule.filters) return true;
  for (const [key, value] of Object.entries(rule.filters)) {
    const ctxVal = (context.payload as any)?.[key] ?? (context as any)[key];
    if (ctxVal !== value) return false;
  }
  return true;
}

export async function fireTrigger(context: TriggerContext): Promise<void> {
  const rules = loadTriggers().filter((r) => r.enabled);

  for (const rule of rules) {
    if (rule.source !== context.source || rule.event !== context.event) continue;
    if (!matchesFilters(rule, context)) continue;

    logger.info(TAG, "Trigger matched", rule.name, "event=" + context.event);

    for (const actionId of rule.actionIds) {
      const action = loadAction(actionId);
      if (!action || !action.enabled) {
        logger.warn(TAG, "Action not found or disabled", actionId);
        continue;
      }

      const results = await executeAction(action, context);
      for (const r of results) {
        if (!r.success) {
          logger.warn(TAG, "Action step failed", action.name, r.type, r.error);
        }
      }
    }
  }
}

/** Helper to fire a chat message trigger from a webhook */
export function fireChatMessage(
  source: TriggerSource,
  channelId: string,
  userId: string | number,
  userName: string,
  messageText: string,
  messageId: string,
  payload: Record<string, any> = {}
): void {
  fireTrigger({
    source,
    event: TriggerEvent.KickChatMessage,
    payload,
    timestamp: Date.now(),
    channelId,
    userId,
    userName,
    messageId,
    messageText,
  });
}
