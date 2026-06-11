import { actor, agent, agentSession, db, sessionActivity, task } from '@docket/db';
import type { SessionActivityBody } from '@docket/db';
import type { SessionActionBody, SessionActivity } from '@docket/boundaries';
import { and, asc, eq } from 'drizzle-orm';

import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { ensureDefaultAgent } from '../lib/default-agent';

import type { SessionRow } from './agent-session-helpers';

/** Map one streamed {@link SessionActivity} to a persisted {@link SessionActivityBody}. */
export function toActivityBody(activity: SessionActivity): SessionActivityBody {
  if (activity.type === 'action') {
    const action = activity.body as SessionActionBody;
    return {
      action: {
        kind: action.kind,
        summary: action.summary,
        ...(action.diff !== undefined ? { diff: action.diff } : {}),
      },
    };
  }
  return { text: typeof activity.body === 'string' ? activity.body : '' };
}

/**
 * Create a session bound to an agent from a freeform prompt, then run it.
 *
 * @remarks
 * The UI-callable "ask Athena to plan" escalation (DECISION: hybrid prompt→Athena). The
 * session binds to the supplied `agentId` (validated in-org) or — when omitted — the
 * org's lazily-resolved default agent, so escalation works with no agent pre-setup. The
 * prompt is persisted as the session's first `response` activity (there is no schema
 * brief column) so {@link runSession} threads it through as the runtime `task` brief;
 * the session then runs and settles like any other. Trigger is `delegation` (a human
 * delegating planning to the agent), matching `trigger_agent`'s default.
 *
 * @param orgId - The active organization id.
 * @param actorId - The caller's actor id (the session initiator + prompt author).
 * @param prompt - The freeform brief the agent should plan against.
 * @param agentId - An explicit agent to bind to; the default agent is used when omitted.
 * @returns the settled session row.
 * @throws {NotFoundError} When an explicit `agentId` is not a registered agent in the org.
 */
export async function createAndRunFromPrompt(
  orgId: string,
  actorId: string,
  prompt: string,
  agentId?: string,
): Promise<SessionRow> {
  let boundAgentId: string;
  if (agentId !== undefined) {
    const agentRows = await db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.id, agentId), eq(agent.organizationId, orgId)))
      .limit(1);
    if (!agentRows[0]) throw new NotFoundError('Agent not found');
    boundAgentId = agentRows[0].id;
  } else {
    boundAgentId = (await ensureDefaultAgent(orgId, actorId)).id;
  }

  const sessionId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentSession)
      .values({
        organizationId: orgId,
        agentId: boundAgentId,
        trigger: 'delegation',
        status: 'pending',
        initiatorId: actorId,
      })
      .returning({ id: agentSession.id });
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!created) throw new Error('session insert returned no row');

    // Persist the freeform prompt as the session's first activity so the brief survives
    // to `runSession` (a `response` is a human-authored stream entry, like a reply).
    await tx.insert(sessionActivity).values({
      sessionId: created.id,
      organizationId: orgId,
      type: 'response',
      body: { text: prompt },
    });
    return created.id;
  });

  return runSession(orgId, sessionId);
}

/**
 * Run a hosted session against the container's {@link AgentRuntime}.
 *
 * @remarks
 * Loads the session (org-scoped), then its linked task + agent to derive the runtime
 * `task` brief and `agent` slug, sets the session `running`, and consumes the
 * (finite, scripted under the mock) activity stream — persisting one
 * {@link sessionActivity} row per yielded {@link SessionActivity} and stamping
 * `approvalStatus='proposed'` on gated `action` activities. After the stream ends the
 * session settles to `awaiting_approval` when a proposed action remains unresolved,
 * else `completed` (with `endedAt`).
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session to run.
 * @returns the settled session row.
 * @throws {NotFoundError} When the session or its agent is not found in the org.
 * @throws {ConflictError} When the session is not in a runnable (`pending`/`running`) state.
 */
export async function runSession(orgId: string, sessionId: string): Promise<SessionRow> {
  const sessionRows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const session = sessionRows[0];
  if (!session) throw new NotFoundError('Session not found');
  if (session.status !== 'pending' && session.status !== 'running') {
    throw new ConflictError('Session is not in a runnable state');
  }

  const agentRows = await db
    .select({ displayName: actor.displayName })
    .from(agent)
    .innerJoin(actor, eq(agent.actorId, actor.id))
    .where(and(eq(agent.id, session.agentId), eq(agent.organizationId, orgId)))
    .limit(1);
  const agentRow = agentRows[0];
  if (!agentRow) throw new NotFoundError('Agent not found');

  // Derive the brief the runtime works on: a linked task's title when the session is
  // task-bound, else the freeform prompt the session was seeded with (a `response`
  // activity authored at create time — the "ask Athena to plan" / trigger_agent prompt),
  // else the session id as a last resort. This is how a freeform prompt reaches
  // `startSession.task` with no schema brief column.
  let taskBrief = sessionId;
  if (session.taskId) {
    const taskRows = await db
      .select({ title: task.title })
      .from(task)
      .where(and(eq(task.id, session.taskId), eq(task.organizationId, orgId)))
      .limit(1);
    if (taskRows[0]) taskBrief = taskRows[0].title;
  } else {
    const promptRows = await db
      .select({ body: sessionActivity.body })
      .from(sessionActivity)
      .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'response')))
      .orderBy(asc(sessionActivity.createdAt))
      .limit(1);
    const promptText = promptRows[0]?.body.text;
    if (promptText) taskBrief = promptText;
  }

  await db
    .update(agentSession)
    .set({ status: 'running', startedAt: session.startedAt ?? new Date() })
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)));

  let hasProposed = false;
  const stream = getContainer().agentRuntime.startSession({
    sessionId,
    task: taskBrief,
    agent: agentRow.displayName,
  });
  for await (const activity of stream) {
    const isProposed = activity.type === 'action' && activity.approval === 'proposed';
    if (isProposed) hasProposed = true;
    await db.insert(sessionActivity).values({
      sessionId,
      organizationId: orgId,
      type: activity.type,
      body: toActivityBody(activity),
      ...(isProposed ? { approvalStatus: 'proposed' as const } : {}),
    });
  }

  const nextStatus = hasProposed ? 'awaiting_approval' : 'completed';
  const [settled] = await db
    .update(agentSession)
    .set({
      status: nextStatus,
      ...(nextStatus === 'completed' ? { endedAt: new Date() } : {}),
    })
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .returning();
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!settled) throw new Error('session update returned no row');
  return settled;
}
