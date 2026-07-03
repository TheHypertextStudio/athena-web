/**
 * `@docket/api` — the automation engine orchestrator.
 *
 * @remarks
 * Generic by construction: it knows nothing about email, mail verbs, or thresholds. For one
 * event it selects enabled rules whose `on` {@link matches} and whose `when` predicate the
 * Interpreter satisfies, then dispatches each `then` Command to its registered handler
 * (Strategy). The event is an observation projected to a plain record; rules and the registry
 * are injected. An action with no registered handler is a logged no-op, never a throw. See
 * `docs/engineering/specs/automations.md`.
 */
import type { AutomationEventMatch, AutomationRule } from '@docket/types';

import { evaluate } from './predicate';
import type { Registry } from './registry';

/** Context handed to every action handler (handlers close over their own services). */
export interface ActionContext {
  readonly event: unknown;
}

/** A rule as held by the engine: a stored rule plus its enabled flag. */
export interface EngineRule extends AutomationRule {
  readonly enabled: boolean;
}

/** One dispatched action's outcome (`ran=false` when no handler is registered). */
export interface DispatchedAction {
  readonly type: string;
  readonly ran: boolean;
}

/**
 * Whether an event matches a rule's `on` clause.
 *
 * @remarks
 * Each present field must equal the event's; an absent field is a wildcard. An empty `on`
 * (no fields) therefore matches every event. `kind`/`subjectType` address internal Docket
 * events; `source`/`entityKind` additionally address external events (which carry no Docket
 * subject type) by origin and canonical kind.
 */
export function matches(on: AutomationEventMatch, event: unknown): boolean {
  const record = (event ?? {}) as Record<string, unknown>;
  if (on.kind !== undefined && record['kind'] !== on.kind) return false;
  if (on.subjectType !== undefined && record['subjectType'] !== on.subjectType) return false;
  if (on.source !== undefined && record['source'] !== on.source) return false;
  if (on.entityKind !== undefined && record['entityKind'] !== on.entityKind) return false;
  return true;
}

/**
 * Run all matching, enabled, satisfied rules against one event.
 *
 * @param event - The event object (an observation projected to a plain record).
 * @param rules - The org's rules (already loaded from `automation_rule`).
 * @param registry - The action-handler Strategy registry.
 * @returns the outcome of every dispatched action, in order.
 */
export async function runAutomations(
  event: unknown,
  rules: readonly EngineRule[],
  registry: Registry,
): Promise<DispatchedAction[]> {
  const dispatched: DispatchedAction[] = [];
  const context: ActionContext = { event };
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matches(rule.on, event)) continue;
    if (!evaluate(rule.when, event)) continue;
    for (const action of rule.then) {
      const handler = registry.get(action.type);
      if (!handler) {
        dispatched.push({ type: action.type, ran: false });
        continue;
      }
      await handler.run(context, action.params);
      dispatched.push({ type: action.type, ran: true });
    }
  }
  return dispatched;
}
