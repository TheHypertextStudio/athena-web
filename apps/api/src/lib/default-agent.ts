/**
 * `@docket/api` — the lazy default-agent resolver.
 *
 * @remarks
 * The hybrid prompt→Athena surface (quick-capture + "ask Athena to plan") must work
 * with NO pre-setup: a brand-new org has no registered {@link agent}, yet a user can
 * still escalate a freeform prompt into a planned session. This helper finds the org's
 * default agent (a registered agent whose Actor's display name is {@link DEFAULT_AGENT_NAME})
 * or lazily materializes one — its agent Actor (`kind='agent'`) plus the `agent` row —
 * so {@link import('../routes/agent-sessions')} and the `trigger_agent` MCP tool can bind
 * a session to it on first use. The runtime that actually executes the session stays the
 * boundary {@link import('@docket/boundaries').AgentRuntime} (the mock under
 * `APP_MODE ∈ {local,test}`); this only guarantees a persistent org-scoped agent exists.
 */
import { actor, agent, db } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';

/** The display name of the lazily-provisioned default org agent ("Athena"). */
export const DEFAULT_AGENT_NAME = 'Athena';

/** A resolved default agent: its `agent` row id plus the backing Actor's display name. */
export interface DefaultAgent {
  /** The `agent` row id (what an `agent_session.agent_id` references). */
  readonly id: string;
  /** The backing agent Actor's display name (the runtime `agent` slug). */
  readonly displayName: string;
}

/**
 * Find — or lazily create — the org's default agent ("Athena").
 *
 * @remarks
 * Idempotent: the lookup matches an existing registered {@link agent} whose backing
 * {@link actor} is an `agent`-kind actor named {@link DEFAULT_AGENT_NAME} (the oldest
 * such agent wins, so repeated calls converge on one row). When none exists it
 * materializes the agent Actor and the `agent` row in a single transaction, attributing
 * `created_by` to the caller. The whole resolve runs inside an optional caller
 * transaction so the create+session-insert can be one atomic unit.
 *
 * @param orgId - The organization to resolve the default agent within.
 * @param createdByActorId - The caller's actor id, recorded as the agent's `created_by`.
 * @returns the resolved {@link DefaultAgent} (existing or freshly created).
 */
export async function ensureDefaultAgent(
  orgId: string,
  createdByActorId: string,
): Promise<DefaultAgent> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: agent.id, displayName: actor.displayName })
      .from(agent)
      .innerJoin(actor, eq(agent.actorId, actor.id))
      .where(
        and(
          eq(agent.organizationId, orgId),
          eq(actor.kind, 'agent'),
          eq(actor.displayName, DEFAULT_AGENT_NAME),
        ),
      )
      .orderBy(asc(agent.createdAt))
      .limit(1);
    const found = existing[0];
    if (found) return { id: found.id, displayName: found.displayName };

    const [agentActor] = await tx
      .insert(actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: DEFAULT_AGENT_NAME })
      .returning({ id: actor.id, displayName: actor.displayName });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!agentActor) throw new Error('default agent actor insert returned no row');

    const [agentRow] = await tx
      .insert(agent)
      .values({ organizationId: orgId, actorId: agentActor.id, createdBy: createdByActorId })
      .returning({ id: agent.id });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!agentRow) throw new Error('default agent insert returned no row');

    return { id: agentRow.id, displayName: agentActor.displayName };
  });
}
