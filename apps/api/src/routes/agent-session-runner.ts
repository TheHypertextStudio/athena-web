import { agent, agentSession, db, sessionActivity } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { driveSession } from '../agent/loop';
import { loadTranscript, saveTranscript } from '../agent/transcript';
import { ensureDefaultAgent } from '../lib/default-agent';

import { loadSession } from './agent-session-helpers';
import type { SessionRow } from './agent-session-helpers';

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
  const agentId = (await ensureDefaultAgent(orgId, initiatorActorId)).id;
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentSession)
      .values({
        organizationId: orgId,
        agentId,
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
      organizationId: orgId,
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

/**
 * Append a human reply to an already-open session and resume the agentic loop to
 * answer it.
 *
 * @remarks
 * The shared "human replied, keep the turn going" sequence. It exists as its own
 * function because more than one door lands a human message on an existing session
 * and then wants the identical resume behavior — today the chat thread
 * (`POST /chat/messages`); a future front door that relays a reply from an external
 * conversation surface back onto its mirrored Docket session is expected to reuse it
 * too, which is why `actorId` is nullable (an external reply's author may not yet
 * resolve to a Docket identity).
 *
 * The reply lands as a visible `response` activity tagged `author: 'user'` — the
 * load-bearing marker downstream consumers use to tell a human (not the agent) wrote
 * it — AND as the next user turn of the durable transcript, so the loop resumes from
 * the exact conversation a human would see. A session is never "done" from a reply's
 * perspective: any non-`pending`/`running` status (parked or terminal) is nudged back
 * to `running` first so {@link driveSession} accepts it instead of conflicting.
 *
 * `actorId` is not read by this sequence today — nothing it writes has an actor-id
 * column — but is threaded through the signature so every caller can pass what it
 * actually knows about the reply's author without a later signature change.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The org-scoped session to reply to and resume.
 * @param actorId - The reply's human author, or `null` when the caller cannot resolve one.
 * @param text - The reply's freeform text.
 * @returns the settled session row after the loop runs.
 * @throws {NotFoundError} When the session is not found in the org.
 */
export async function postReplyAndResume(
  orgId: string,
  sessionId: string,
  actorId: string | null,
  text: string,
): Promise<SessionRow> {
  const session = await loadSession(orgId, sessionId);

  await db.insert(sessionActivity).values({
    sessionId,
    organizationId: orgId,
    type: 'response',
    body: { text, author: 'user' },
  });
  const messages = await loadTranscript(db, sessionId);
  await saveTranscript(db, sessionId, orgId, [
    ...messages,
    { role: 'user', content: [{ type: 'text', text }] },
  ]);
  // A session is never "done" from a reply's perspective: terminal statuses just mean
  // idle, so a new message re-opens it for the loop (pending stays pending — first run
  // gates entitlement there).
  if (session.status !== 'pending' && session.status !== 'running') {
    await db.update(agentSession).set({ status: 'running' }).where(eq(agentSession.id, sessionId));
  }
  return driveSession(orgId, sessionId);
}
