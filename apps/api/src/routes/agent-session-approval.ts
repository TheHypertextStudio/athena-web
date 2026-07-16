import { actor, agent, agentSession, auditEvent, db, sessionActivity } from '@docket/db';
import type { SessionApprovalDecision } from '@docket/types';
import { and, asc, desc, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';

import type { ActivityRow, SessionRow } from './agent-session-helpers';

/** Assert an org compatibility route is addressing the session's persisted context. */
function assertSessionContext(session: SessionRow | undefined, orgId: string): SessionRow {
  if (!session) throw new NotFoundError('Session not found');
  const matches =
    session.executorKind === 'athena'
      ? session.contextOrganizationId === orgId
      : session.organizationId === orgId;
  if (!matches) throw new NotFoundError('Session not found');
  return session;
}

/** Resolve audit attribution for an approval without inventing an Athena Actor. */
async function approvalAuditActor(
  handle: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: SessionRow,
  organizationId: string,
): Promise<string | null> {
  if (session.executorKind === 'athena') {
    const ownerUserId = athenaOwner(session);
    const rows = await handle
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.userId, ownerUserId),
          eq(actor.organizationId, organizationId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }
  const registeredAgentId = session.agentId;
  if (!registeredAgentId) throw new Error('Registered-agent session is missing its agent');
  const rows = await handle
    .select({ actorId: agent.actorId })
    .from(agent)
    .where(and(eq(agent.id, registeredAgentId), eq(agent.organizationId, organizationId)))
    .limit(1);
  return rows[0]?.actorId ?? null;
}

/** Return an Athena owner after checking the persisted executor shape. */
function athenaOwner(session: SessionRow): string {
  if (session.executorKind !== 'athena' || !session.ownerUserId) {
    throw new Error('Athena session is missing its owner');
  }
  return session.ownerUserId;
}

/** Structured origin fields attached to user-owned Athena audit events. */
function athenaAuditOrigin(session: SessionRow): Record<string, string> {
  return session.executorKind === 'athena'
    ? {
        executionOrigin: 'athena',
        athenaSessionId: session.id,
        requestedByUserId: athenaOwner(session),
      }
    : {};
}

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
      .where(eq(agentSession.id, sessionId))
      .limit(1);
    const session = assertSessionContext(sessionRows[0], orgId);
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

    const [decided] = await tx
      .update(sessionActivity)
      .set({ approvalStatus: decision })
      .where(and(eq(sessionActivity.id, action.id), eq(sessionActivity.approvalStatus, 'proposed')))
      .returning({ id: sessionActivity.id });
    if (!decided) throw new ConflictError('No proposed action awaiting approval');

    const nextStatus = decision === 'approved' ? 'running' : 'canceled';
    const [updated] = await tx
      .update(agentSession)
      .set({
        status: nextStatus,
        ...(decision === 'rejected' ? { endedAt: new Date() } : {}),
      })
      .where(eq(agentSession.id, sessionId))
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
 * The targeted activity must belong to a visible registered or caller-owned session, be
 * `type='action'`,
 * and currently be `proposed`. On `approve` the activity advances conditionally to `approved` and
 * an `audit_event` (`type='approved'`,
 * `subjectType='agent_session'`) is written with the authorization Actor as `actorId`, the session
 * initiator as `initiatorId`, and the approved activity id + approver recorded in `metadata`.
 * Athena events also carry structured execution-origin metadata. The admitted run then claims
 * `approved → executing` before MCP dispatch and settles `applied` only after the result is durable.
 * On `reject` the activity becomes
 * `rejected` and a `type='rejected'`
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
      .where(eq(agentSession.id, sessionId))
      .limit(1);
    const session = assertSessionContext(sessionRows[0], orgId);

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
      const nextApprovalStatus = decision.decision === 'approve' ? 'approved' : 'rejected';
      const [decidedRow] = await tx
        .update(sessionActivity)
        .set({ approvalStatus: nextApprovalStatus })
        .where(
          and(eq(sessionActivity.id, action.id), eq(sessionActivity.approvalStatus, 'proposed')),
        )
        .returning();
      if (!decidedRow) {
        if (action.id === activityId) {
          throw new ConflictError('Activity is not a proposed action');
        }
        continue;
      }

      const auditOrganizationId = action.organizationId ?? orgId;
      const authorizationActorId = await approvalAuditActor(tx, session, auditOrganizationId);
      if (decision.decision === 'approve') {
        await tx.insert(auditEvent).values({
          organizationId: auditOrganizationId,
          actorId: authorizationActorId,
          initiatorId: session.initiatorId,
          subjectType: 'agent_session',
          subjectId: sessionId,
          type: 'approved',
          metadata: {
            activityId: action.id,
            approverActorId,
            ...athenaAuditOrigin(session),
          },
        });
        if (action.id === activityId) decidedTarget = decidedRow;
      } else {
        await tx.insert(auditEvent).values({
          organizationId: auditOrganizationId,
          actorId: authorizationActorId,
          initiatorId: session.initiatorId,
          subjectType: 'agent_session',
          subjectId: sessionId,
          type: 'rejected',
          metadata: {
            activityId: action.id,
            approverActorId,
            ...athenaAuditOrigin(session),
          },
        });
        if (action.id === activityId) decidedTarget = decidedRow;
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
        .where(eq(agentSession.id, sessionId));
    }

    return decidedTarget;
  });
}

/**
 * Decide on a whole proposal group (batch approval), optionally narrowed to a subset.
 *
 * @remarks
 * The batch counterpart of {@link decideActivity}: every still-`proposed` action of
 * the group (∩ `activityIds` when given) is decided in ONE transaction with the same
 * per-action audit rows, and the session returns to `running` once no proposed action
 * remains (reject-and-continue included). 404s when the group has no proposed member.
 *
 * @param orgId - The active organization id.
 * @param approverActorId - The approver's actor id (recorded in the audit metadata).
 * @param sessionId - The session that owns the group.
 * @param proposalGroupId - The batch to decide.
 * @param decision - `approve` or `reject`.
 * @param activityIds - Optional subset ("approve selected"); omitted = the whole group.
 * @returns the decided activity rows, oldest-first.
 */
export async function decideProposalGroup(
  orgId: string,
  approverActorId: string,
  sessionId: string,
  proposalGroupId: string,
  decision: 'approve' | 'reject',
  activityIds?: readonly string[],
): Promise<ActivityRow[]> {
  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, sessionId))
      .limit(1);
    const session = assertSessionContext(sessionRows[0], orgId);

    const members = await tx
      .select()
      .from(sessionActivity)
      .where(
        and(
          eq(sessionActivity.sessionId, sessionId),
          eq(sessionActivity.type, 'action'),
          eq(sessionActivity.approvalStatus, 'proposed'),
          eq(sessionActivity.proposalGroupId, proposalGroupId),
        ),
      )
      .orderBy(asc(sessionActivity.createdAt));
    const wanted = activityIds ? new Set(activityIds) : null;
    const targets = wanted ? members.filter((m) => wanted.has(m.id)) : members;
    if (targets.length === 0) throw new NotFoundError('No proposed actions in the group');

    const decided: ActivityRow[] = [];
    for (const action of targets) {
      const [row] = await tx
        .update(sessionActivity)
        .set({ approvalStatus: decision === 'approve' ? 'approved' : 'rejected' })
        .where(
          and(eq(sessionActivity.id, action.id), eq(sessionActivity.approvalStatus, 'proposed')),
        )
        .returning();
      if (!row) continue;

      const auditOrganizationId = action.organizationId ?? orgId;
      const authorizationActorId = await approvalAuditActor(tx, session, auditOrganizationId);
      await tx.insert(auditEvent).values({
        organizationId: auditOrganizationId,
        actorId: authorizationActorId,
        initiatorId: session.initiatorId,
        subjectType: 'agent_session',
        subjectId: sessionId,
        type: decision === 'approve' ? 'approved' : 'rejected',
        metadata: {
          activityId: action.id,
          approverActorId,
          proposalGroupId,
          ...athenaAuditOrigin(session),
        },
      });
      decided.push(row);
    }
    if (decided.length === 0) throw new NotFoundError('No proposed actions in the group');

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
      await tx
        .update(agentSession)
        .set({ status: 'running' })
        .where(eq(agentSession.id, sessionId));
    }

    return decided;
  });
}

/**
 * Reply to an agent `elicitation` — append a human `response` and resume if waiting.
 *
 * @remarks
 * Mirrors contract §3.11 `POST /:sessionId/messages`: the referenced activity must be
 * an `elicitation` belonging to the visible registered or caller-owned session. A new response is
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
      .where(eq(agentSession.id, sessionId))
      .limit(1);
    const session = assertSessionContext(sessionRows[0], orgId);

    const promptRows = await tx
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
      .for('update')
      .limit(1);
    const prompt = promptRows[0];
    if (!prompt) throw new NotFoundError('Activity not found');
    if (prompt.type !== 'elicitation') {
      throw new ConflictError('Activity is not an elicitation');
    }

    const toolUseId =
      typeof prompt.body['toolUseId'] === 'string' ? prompt.body['toolUseId'] : undefined;
    if (toolUseId) {
      const priorResponses = await tx
        .select({ body: sessionActivity.body })
        .from(sessionActivity)
        .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'response')));
      if (priorResponses.some((response) => response.body['toolUseId'] === toolUseId)) {
        throw new ConflictError('Elicitation already has a reply');
      }
    }

    const [created] = await tx
      .insert(sessionActivity)
      .values({
        sessionId,
        organizationId: session.executorKind === 'athena' ? null : orgId,
        type: 'response',
        body: { text, ...(toolUseId ? { toolUseId } : {}) },
      })
      .returning();
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!created) throw new Error('activity insert returned no row');

    if (session.status === 'awaiting_input') {
      await tx
        .update(agentSession)
        .set({ status: 'running' })
        .where(eq(agentSession.id, sessionId));
    }

    return created;
  });
}
