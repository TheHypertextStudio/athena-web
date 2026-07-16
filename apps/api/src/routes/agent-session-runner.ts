import { actor, agent, agentSession, db, sessionActivity } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { driveSession } from '../agent/loop';

import type { SessionRow } from './agent-session-helpers';

/**
 * Create a session bound to an agent from a freeform prompt, then run it.
 *
 * @remarks
 * The UI-callable "ask Athena to plan" escalation (DECISION: hybrid prompt→Athena). The
 * session binds to the supplied registered `agentId` (validated in-org) or — when omitted — to
 * user-owned Athena using the caller's persisted Better Auth user id. The
 * prompt is persisted as the session's first `response` activity (there is no schema
 * brief column) so {@link runSession} threads it through as the runtime `task` brief;
 * the session then runs and settles like any other. Trigger is `delegation` (a human
 * delegating planning to the agent), matching `trigger_agent`'s default.
 *
 * @param orgId - The active organization id.
 * @param actorId - The caller's actor id (the session initiator + prompt author).
 * @param prompt - The freeform brief the agent should plan against.
 * @param agentId - An explicit registered agent; omission selects user-owned Athena.
 * @returns the settled session row.
 * @throws {NotFoundError} When an explicit `agentId` is not a registered agent in the org.
 */
export async function createAndRunFromPrompt(
  orgId: string,
  actorId: string,
  prompt: string,
  agentId?: string,
): Promise<SessionRow> {
  let boundAgentId: string | null = null;
  let ownerUserId: string | null = null;
  if (agentId !== undefined) {
    const agentRows = await db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.organizationId, orgId)))
      .limit(1);
    if (!agentRows[0]) throw new NotFoundError('Agent not found');
    boundAgentId = agentRows[0].id;
  } else {
    ownerUserId = await ownerUserIdForActor(orgId, actorId);
  }

  const sessionId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentSession)
      .values(
        ownerUserId
          ? {
              executorKind: 'athena',
              ownerUserId,
              contextOrganizationId: orgId,
              trigger: 'delegation',
              status: 'pending',
              initiatorId: actorId,
            }
          : {
              executorKind: 'registered_agent',
              organizationId: orgId,
              agentId: boundAgentId ?? missingRegisteredAgent(),
              trigger: 'delegation',
              status: 'pending',
              initiatorId: actorId,
            },
      )
      .returning({ id: agentSession.id });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!created) throw new Error('session insert returned no row');

    // Persist the freeform prompt as the session's first activity so the brief survives
    // to `runSession` (a `response` is a human-authored stream entry, like a reply).
    await tx.insert(sessionActivity).values({
      sessionId: created.id,
      organizationId: ownerUserId ? null : orgId,
      type: 'response',
      body: { text: prompt },
    });
    return created.id;
  });

  return runSession(orgId, sessionId);
}

/** Defensive branch for a registered-agent insert whose validated id vanished. */
function missingRegisteredAgent(): never {
  throw new Error('Registered-agent session is missing its agent');
}

/**
 * Resolve the user behind an active human Actor in the requested workspace.
 *
 * @param orgId - The current workspace context.
 * @param actorId - The authenticated human Actor in that workspace.
 * @returns the Better Auth user id persisted as Athena's owner.
 * @throws {NotFoundError} When the Actor is absent, inactive, non-human, or not user-backed.
 */
export async function ownerUserIdForActor(orgId: string, actorId: string): Promise<string> {
  const rows = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(
      and(
        eq(actor.id, actorId),
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  const ownerUserId = rows[0]?.userId;
  if (!ownerUserId) throw new NotFoundError('User not found');
  return ownerUserId;
}

/**
 * Create a PENDING agent session from an observation (the proactive trigger), without running it.
 *
 * @remarks
 * The drafted-plan engine: a `mention`/`assignment` observation seeds a session whose first
 * `response` activity is the prompt built from the event. Idempotent via the unique partial index
 * on `external_run_ref` (`observation:<id>:<user>`), so a re-scan never spawns a duplicate run.
 * The lease-guarded {@link sweepProactiveSessions} runs it later (decoupled from the LLM call).
 *
 * @param orgId - The org the observation belongs to.
 * @param initiatorActorId - The recipient's Actor in that org (the accountable initiator).
 * @param externalRunRef - The idempotency key (`observation:<observationId>:<userId>`).
 * @param trigger - `mention` or `assignment`.
 * @param prompt - The brief seeded as the session's first activity.
 * @returns the new session id, or `null` when one already exists for this ref.
 */
export async function createSessionFromObservation(
  orgId: string,
  initiatorActorId: string,
  externalRunRef: string,
  trigger: 'mention' | 'assignment',
  prompt: string,
): Promise<string | null> {
  const ownerUserId = await ownerUserIdForActor(orgId, initiatorActorId);
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        contextOrganizationId: orgId,
        trigger,
        status: 'pending',
        initiatorId: initiatorActorId,
        externalRunRef,
      })
      .onConflictDoNothing({
        target: agentSession.externalRunRef,
        where: sql`${agentSession.externalRunRef} is not null`,
      })
      .returning({ id: agentSession.id });
    if (!created) return null;
    await tx.insert(sessionActivity).values({
      sessionId: created.id,
      organizationId: null,
      type: 'response',
      body: { text: prompt },
    });
    return created.id;
  });
}

/**
 * Run a hosted session against the agentic loop.
 *
 * @remarks
 * Kept as the runner's exported name — the session routes, the `trigger_agent` MCP
 * tool, and the proactive sweep all call it — but the implementation is now the
 * re-entrant {@link driveSession}: transcript-backed multi-turn tool use over the
 * in-process MCP toolbox, gated by the agent's approval dial.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session to run.
 * @returns the settled session row.
 */
export async function runSession(orgId: string, sessionId: string): Promise<SessionRow> {
  return driveSession(orgId, sessionId);
}
