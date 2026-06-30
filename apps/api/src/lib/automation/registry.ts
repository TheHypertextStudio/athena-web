/**
 * `@docket/api` — the automation action-handler registry (the Strategy registry).
 *
 * @remarks
 * Action handlers register themselves by a `type` string (`mail.archive`,
 * `suggestion.autoAccept`, `task.route`, …); the engine dispatches a {@link
 * import('@docket/types').ActionSpec} by looking its `type` up here. Adding a new action is
 * registering a handler — the engine is never edited. Handlers close over whatever services
 * they need (db, connector) at registration time, so {@link ActionContext} stays minimal.
 * See `docs/engineering/specs/email-to-task.md` §7.
 */
import type { ActionContext } from './engine';

/** An action handler — a Strategy invoked by the engine for one action `type`. */
export interface ActionHandler {
  readonly type: string;
  run(ctx: ActionContext, params: Record<string, unknown>): Promise<void> | void;
}

/** A registry of action handlers keyed by `type`. */
export interface Registry {
  /** Register a handler; the last registration for a `type` wins. */
  register(handler: ActionHandler): void;
  /** Look up a handler by `type`, or `undefined` when none is registered. */
  get(type: string): ActionHandler | undefined;
}

/** Create an empty action-handler registry. */
export function createRegistry(): Registry {
  const handlers = new Map<string, ActionHandler>();
  return {
    register: (handler) => void handlers.set(handler.type, handler),
    get: (type) => handlers.get(type),
  };
}
