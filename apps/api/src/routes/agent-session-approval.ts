import { agent, agentSession, auditEvent, db, sessionActivity } from '@docket/db';
import type { SessionApprovalDecision } from '@docket/types';
import { and, asc, desc, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';

import type { ActivityRow, SessionRow } from './agent-session-helpers';

/**
 * Flip the latest `awaiting_approval` action of a session to approved/rejected and
 * move the session forward (running on approve, canceled on reject), atomically.
 */
export async function resolveAction(
  orgId: string,
  sessionId: string,
  decision: 'approved' | 'rejected',
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .limit(1);
    const session = sessionRows[0];
    if (!session) throw new NotFoundError('Session not found');
    if (session.status !== 'awaiting_approval') {
      throw new ConflictError('Session is not awaiting approval');
    }

    const pending = await tx
      .select()
      .from(sessionActivity)
      .where(
        and(
          eq(sessionActivity.sessionId, sessionId),
          eq(sessionActivity.type, 'action'),
          eq(sessionActivity.approvalStatus, 'proposed'),
        ),
      )
      .orderBy(desc(sessionActivity.createdAt))
      .limit(1);
    const action = pending[0];
    if (!action) throw new ConflictError('No proposed action awaiting approval');

    await tx
      .update(sessionActivity)
      .set({ approvalStatus: decision })
      .where(eq(sessionActivity.id, action.id));

    const nextStatus = decision === 'approved' ? 'running' : 'canceled';
    const [updated] = await tx
      .update(agentSession)
      .set({
        status: nextStatus,
        ...(decision === 'rejected' ? { endedAt: new Date() } : {}),
      })
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .returning();
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!updated) throw new Error('session update returned no row');
    return updated;
  });
}

/**
 * Decide on a single gated `action` activity (the approval gate; permissions §9.3).
 *
 * @remarks
 * The targeted activity must belong to the (org-scoped) session, be `type='action'`,
 * and currently be `proposed`. On `approve` the activity advances to `applied` (the
 * gate's terminal applied state) and an `audit_event` (`type='approved'`,
 * `subjectType='agent_session'`) is written with the agent as `actorId`, the session
 * initiator as `initiatorId`, and the approved activity id + approver recorded in
 * `metadata`. On `reject` the activity becomes `rejected` and a `type='rejected'`
 * audit_event is written (no apply). With
 * `scope='all_in_session'` every still-`proposed` action in the session is decided the
 * same way in the same transaction. Finally the session advances: to `running` once no
 * proposed action remains after an approval, or to `canceled` (with `endedAt`) when a
 * rejection leaves no proposed action remaining.
 *
 * @param orgId - The active organization id.
 * @param approverActorId - The approver's actor id (recorded in the audit metadata).
 * @param sessionId - The session that owns the activity.
 * @param activityId - The proposed action activity to decide.
 * @param decision - `{ decision, scope? }` — approve/reject and single-vs-all scope.
 * @returns the decided target activity row (the one named by `activityId`).
 * @throws {NotFoundError} When the session or the activity is not found in the org.
 * @throws {ConflictError} When the activity is not a `proposed` action.
 */
export async function decideActivity(
  orgId: string,
  approverActorId: string,
  sessionId: string,
  activityId: string,
  decision: SessionApprovalDecision,
): Promise<ActivityRow> {
  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .limit(1);
    const session = sessionRows[0];
    if (!session) throw new NotFoundError('Session not found');

    // The audit feed records the agent's *actor* id (audit_event.actor_id → actor.id),
    // not the agent row id; resolve it once for every action we decide below.
    const agentRows = await tx
      .select({ actorId: agent.actorId })
      .from(agent)
      .where(and(eq(agent.id, session.agentId), eq(agent.organizationId, orgId)))
      .limit(1);
    const agentActorId = agentRows[0]?.actorId ?? null;

    const targetRows = await tx
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new NotFoundError('Activity not found');
    if (target.type !== 'action' || target.approvalStatus !== 'proposed') {
      throw new ConflictError('Activity is not a proposed action');
    }

    const targets =
      decision.scope === 'all_in_session'
        ? await tx
            .select()
            .from(sessionActivity)
            .where(
              and(
                eq(sessionActivity.sessionId, sessionId),
                eq(sessionActivity.type, 'action'),
                eq(sessionActivity.approvalStatus, 'proposed'),
              ),
            )
            .orderBy(asc(sessionActivity.createdAt))
        : [target];

    let decidedTarget = target;
    for (const action of targets) {
      if (decision.decision === 'approve') {
        await tx.insert(auditEvent).values({
          organizationId: orgId,
          actorId: agentActorId,
          initiatorId: session.initiatorId,
          subjectType: 'agent_session',
          subjectId: sessionId,
          type: 'approved',
          metadata: { activityId: action.id, approverActorId },
        });
        // `approved` is the transient gate state: the post-commit executor
        // (`executeApprovedActions`) runs the stored toolCall and advances it to
        // `applied` with the real result. Legacy narration-only actions are applied
        // there too, without execution.
        const [approvedRow] = await tx
          .update(sessionActivity)
          .set({ approvalStatus: 'approved' })
          .where(eq(sessionActivity.id, action.id))
          .returning();
        /* v8 ignore next -- @preserve defensive: update always returns a row */
        if (!approvedRow) throw new Error('activity update returned no row');
        if (action.id === activityId) decidedTarget = approvedRow;
      } else {
        await tx.insert(auditEvent).values({
          organizationId: orgId,
          actorId: agentActorId,
          initiatorId: session.initiatorId,
          subjectType: 'agent_session',
          subjectId: sessionId,
          type: 'rejected',
          metadata: { activityId: action.id, approverActorId },
        });
        const [rejected] = await tx
          .update(sessionActivity)
          .set({ approvalStatus: 'rejected' })
          .where(eq(sessionActivity.id, action.id))
          .returning();
        /* v8 ignore next -- @preserve defensive: update always returns a row */
        if (!rejected) throw new Error('activity update returned no row');
        if (action.id === activityId) decidedTarget = rejected;
      }
    }

    const remaining = await tx
      .select({ id: sessionActivity.id })
      .from(sessionActivity)
      .where(
        and(
          eq(sessionActivity.sessionId, sessionId),
          eq(sessionActivity.type, 'action'),
          eq(sessionActivity.approvalStatus, 'proposed'),
        ),
      )
      .limit(1);

    if (remaining.length === 0) {
      // Reject-and-continue: with a live loop, a rejection is FEEDBACK — the reconcile
      // step feeds it to the model as an isError tool_result so the agent adapts. Only
      // the session-level `/reject` shortcut ({@link resolveAction}) keeps cancel
      // semantics.
      await tx
        .update(agentSession)
        .set({ status: 'running' })
        .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)));
    }

    return decidedTarget;
  });
}

/**
 * Reply to an agent `elicitation` — append a human `response` and resume if waiting.
 *
 * @remarks
 * Mirrors contract §3.11 `POST /:sessionId/messages`: the referenced activity must be
 * an `elicitation` belonging to the (org-scoped) session. A new `response` activity is
 * appended to the stream carrying the reply text, and when the session was
 * `awaiting_input` it is resumed to `running` so the agent can continue.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session that owns the elicitation.
 * @param activityId - The `elicitation` activity being answered.
 * @param text - The human reply body.
 * @returns the newly created `response` activity row.
 * @throws {NotFoundError} When the session or the elicitation is not found in the org.
 * @throws {ConflictError} When the referenced activity is not an `elicitation`.
 */
export async function replyToElicitation(
  orgId: string,
  sessionId: string,
  activityId: string,
  text: string,
): Promise<ActivityRow> {
  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .limit(1);
    const session = sessionRows[0];
    if (!session) throw new NotFoundError('Session not found');

    const promptRows = await tx
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
      .limit(1);
    const prompt = promptRows[0];
    if (!prompt) throw new NotFoundError('Activity not found');
    if (prompt.type !== 'elicitation') {
      throw new ConflictError('Activity is not an elicitation');
    }

    const [created] = await tx
      .insert(sessionActivity)
      .values({
        sessionId,
        organizationId: orgId,
        type: 'response',
        body: { text },
      })
      .returning();
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!created) throw new Error('activity insert returned no row');

    if (session.status === 'awaiting_input') {
      await tx
        .update(agentSession)
        .set({ status: 'running' })
        .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)));
    }

    return created;
  });
}
