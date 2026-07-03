/**
 * `@docket/api` — pure {@link McpPrincipal} helpers.
 *
 * @remarks
 * Kept separate from `auth.ts` on purpose: `auth.ts` imports the validated env at
 * module scope, and several modules (task-store, cursor pagination, prompts) need
 * only these pure identity projections — importing them from `auth.ts` would drag
 * env validation into every test's top-level module graph.
 */
import type { McpContext } from './auth';

/**
 * A stable identity key for per-caller state (cursor HMACs, task-store ownership).
 *
 * @param ctx - The authenticated caller.
 * @returns the user id for user principals, the agent Actor id for agent principals.
 */
export function principalKey(ctx: McpContext): string {
  return ctx.principal.kind === 'user' ? ctx.principal.userId : ctx.principal.agentActorId;
}

/**
 * The caller's human-readable name for prompt personalization, when known.
 *
 * @param ctx - The authenticated caller.
 * @returns the user's display name (null when unset) or the agent's display name.
 */
export function principalDisplayName(ctx: McpContext): string | null {
  return ctx.principal.kind === 'user' ? ctx.principal.userName : ctx.principal.displayName;
}
