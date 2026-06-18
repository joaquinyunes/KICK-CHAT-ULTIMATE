import { logger } from "../utils/logger";
import type { SubActionHandler, SubActionStep, ActionResult, Action } from "../types/sub-actions";
import { SubActionType } from "../types/sub-actions";
import type { TriggerContext } from "../types/triggers";
import { kickChatHandlers } from "./sub-actions/kick-chat.actions";

const TAG = "action-exec";

const handlers = new Map<SubActionType, SubActionHandler>();

export function registerHandler(handler: SubActionHandler): void {
  handlers.set(handler.type, handler);
}

// Register built-in handlers
for (const h of kickChatHandlers) {
  registerHandler(h);
}

export function getRegisteredTypes(): SubActionType[] {
  return Array.from(handlers.keys());
}

export async function executeAction(
  action: Action,
  context: TriggerContext
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const sorted = [...action.steps]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);

  for (const step of sorted) {
    const handler = handlers.get(step.type);
    if (!handler) {
      const err = "No handler for sub-action type: " + step.type;
      logger.warn(TAG, err);
      results.push({
        success: false,
        stepId: step.id,
        type: step.type,
        error: err,
        durationMs: 0,
      });
      continue;
    }

    const result = await handler.execute(step.params, context);
    result.stepId = step.id;
    results.push(result);

    if (!result.success) {
      logger.warn(TAG, "Step failed, stopping action", step.id, step.type);
      break;
    }
  }

  return results;
}
