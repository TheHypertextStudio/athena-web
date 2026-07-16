import { actor, agent, agentSession, auditEvent, db, sessionActivity } from '@docket/db';
import type { SessionApprovalDecision } from '@docket/types';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { proposalOrganizationId } from '../agent/proposals';
import { persistWaitingAthenaWake } from '../agent/async-runner';
import { ConflictError, NotFoundError } from '../error';

import type { ActivityRow, SessionRow } from './agent-session-helpers';

/** Assert registered-agent work remains in-org; Athena ownership is enforced by its caller. */
function assertSessionContext(session: SessionRow | undefined, orgId: string): SessionRow {
  if (!session) throw new NotFoundError('Session not found');
  // Athena is owner-scoped before this service is called. Its initial workspace is only prompt
  // focus; approvals may target a different workspace and the stored tool reauthorizes there.
  const matches = session.executorKind === 'athena' || session.organizationId === orgId;
  if (!matches) throw new NotFoundError('Session not found');
  return session;
}

/** Current workspace and Actor authorization for one selected approval target. */
interface ApprovalAuthorization {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly approverActorId: string | null;
}

/** Production-only durable continuation requested by a personal route. */
export interface HumanContinuationOptions {
  readonly queueWake?: boolean;
  readonly cancelSession?: boolean;
}

/** Resolve one selected action's current target and audit authorization. */
async function authorizeApprovalTarget(
  handle: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: SessionRow,
  action: ActivityRow,
  fallbackOrganizationId: string,
  fallbackApproverActorId: string | null,
): Promise<ApprovalAuthorization> {
  if (session.executorKind === 'athena') {
    const ownerUserId = athenaOwner(session);
    const organizationId = proposalOrganizationId(action, fallbackOrganizationId);
    const rows = await handle
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.userId, ownerUserId),
          eq(actor.organizationId, organizationId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
          isNull(actor.archivedAt),
        ),
      )
      .limit(1);
    const actorId = rows[0]?.id;
    if (!actorId) throw new NotFoundError('Workspace not found');
    return { organizationId, actorId, approverActorId: actorId };
  }
  const registeredAgentId = session.agentId;
  if (!registeredAgentId) throw new Error('Registered-agent session is missing its agent');
  const organizationId = session.organizationId ?? fallbackOrganizationId;
  const rows = await handle
    .select({ actorId: agent.actorId })
    .from(agent)
    .where(and(eq(agent.id, registeredAgentId), eq(agent.organizationId, organizationId)))
    .limit(1);
  return {
    organizationId,
    actorId: rows[0]?.actorId ?? null,
    approverActorId: fallbackApproverActorId,
  };
}

/** Authorize every selected action before the transaction writes any decision or audit. */
async function authorizeApprovalTargets(
  handle: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: SessionRow,
  actions: readonly ActivityRow[],
  fallbackOrganizationId: string,
  fallbackApproverActorId: string | null,
): Promise<ApprovalAuthorization[]> {
  const authorizations: ApprovalAuthorization[] = [];
  for (const action of actions) {
    authorizations.push(
      await authorizeApprovalTarget(
        handle,
        session,
        action,
        fallbackOrganizationId,
        fallbackApproverActorId,
      ),
    );
  }
  return authorizations;
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
 * same way in the same transaction. Session reopening is deliberately deferred to the
 * durable approval-and-drive primitive so admission failure leaves it parked.
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
  approverActorId: string | null,
  sessionId: string,
  activityId: string,
  decision: SessionApprovalDecision,
  continuation: HumanContinuationOptions = {},
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
    const authorizations = await authorizeApprovalTargets(
      tx,
      session,
      targets,
      orgId,
      approverActorId,
    );

    let decidedTarget = target;
    for (const [index, action] of targets.entries()) {
      const authorization = authorizations[index];
      /* v8 ignore next -- @preserve defensive: authorizations are built from the same targets */
      if (!authorization) throw new Error('approval authorization returned no row');
      const nextApprovalStatus = decision.decision === 'approve' ? 'approved' : 'rejected';
      const [decidedRow] = await tx
        .update(sessionActivity)
        .set({
          approvalStatus: nextApprovalStatus,
          organizationId: authorization.organizationId,
        })
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
      if (decision.decision === 'approve') {
        await tx.insert(auditEvent).values({
          organizationId: authorization.organizationId,
          actorId: authorization.actorId,
          initiatorId: session.initiatorId,
          subjectType: 'agent_session',
          subjectId: sessionId,
          type: 'approved',
          metadata: {
            activityId: action.id,
            approverActorId: authorization.approverActorId,
            ...athenaAuditOrigin(session),
          },
        });
        // `approved` is the transient gate state: the admitted executor claims it as
        // `executing` before dispatch and advances it only after the result is durable.
        if (action.id === activityId) decidedTarget = decidedRow;
      } else {
        await tx.insert(auditEvent).values({
          organizationId: authorization.organizationId,
          actorId: authorization.actorId,
          initiatorId: session.initiatorId,
          subjectType: 'agent_session',
          subjectId: sessionId,
          type: 'rejected',
          metadata: {
            activityId: action.id,
            approverActorId: authorization.approverActorId,
            ...athenaAuditOrigin(session),
          },
        });
        if (action.id === activityId) decidedTarget = decidedRow;
      }
    }

    if (continuation.cancelSession) {
      await tx
        .update(agentSession)
        .set({ status: 'canceled', endedAt: new Date() })
        .where(eq(agentSession.id, sessionId));
    }
    if (continuation.queueWake) await persistWaitingAthenaWake(tx, sessionId);

    return decidedTarget;
  });
}

/**
 * Decide on a whole proposal group (batch approval), optionally narrowed to a subset.
 *
 * @remarks
 * The batch counterpart of {@link decideActivity}: every still-`proposed` action of
 * the group (∩ `activityIds` when given) is decided in ONE transaction with the same
 * per-action audit rows. The durable caller decides whether the remaining proposal set
 * permits reopening after admission. 404s when the group has no proposed member.
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
  approverActorId: string | null,
  sessionId: string,
  proposalGroupId: string,
  decision: 'approve' | 'reject',
  activityIds?: readonly string[],
  continuation: HumanContinuationOptions = {},
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
    const authorizations = await authorizeApprovalTargets(
      tx,
      session,
      targets,
      orgId,
      approverActorId,
    );

    const decided: ActivityRow[] = [];
    for (const [index, action] of targets.entries()) {
      const authorization = authorizations[index];
      /* v8 ignore next -- @preserve defensive: authorizations are built from the same targets */
      if (!authorization) throw new Error('approval authorization returned no row');
      const [row] = await tx
        .update(sessionActivity)
        .set({
          approvalStatus: decision === 'approve' ? 'approved' : 'rejected',
          organizationId: authorization.organizationId,
        })
        .where(
          and(eq(sessionActivity.id, action.id), eq(sessionActivity.approvalStatus, 'proposed')),
        )
        .returning();
      if (!row) continue;
      await tx.insert(auditEvent).values({
        organizationId: authorization.organizationId,
        actorId: authorization.actorId,
        initiatorId: session.initiatorId,
        subjectType: 'agent_session',
        subjectId: sessionId,
        type: decision === 'approve' ? 'approved' : 'rejected',
        metadata: {
          activityId: action.id,
          approverActorId: authorization.approverActorId,
          proposalGroupId,
          ...athenaAuditOrigin(session),
        },
      });
      decided.push(row);
    }
    if (decided.length === 0) throw new NotFoundError('No proposed actions in the group');
    if (continuation.queueWake) await persistWaitingAthenaWake(tx, sessionId);

    return decided;
  });
}

/**
 * Reply to an agent `elicitation` by appending one human `response`.
 *
 * @remarks
 * Mirrors contract §3.11 `POST /:sessionId/messages`: the referenced activity must be
 * an `elicitation` belonging to the visible registered or caller-owned session. A new response is
 * appended to the stream carrying the reply text. Transcript-backed callers resume separately
 * through durable generation admission; legacy callers may perform a status-only transition.
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
  continuation: HumanContinuationOptions = {},
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
    if (continuation.queueWake) await persistWaitingAthenaWake(tx, sessionId);

    return created;
  });
}
