/**
 * `@docket/api` — agent-sessions router (mounted at `/v1/orgs/:orgId/sessions`).
 *
 * @remarks
 * Run + read + approval surface over Docket-hosted {@link agentSession}s and their
 * visible {@link sessionActivity} stream. Execution runs the
 * {@link getContainer | container}'s {@link AgentRuntime} (the MockAgentRuntime under
 * `APP_MODE=local`): `POST /:id/run` consumes the runtime's activity stream and
 * persists each activity, then settles the session to `awaiting_approval` (if a
 * proposed action remains) or `completed`. `GET /:id/stream` replays the stored
 * activities over SSE. This router otherwise models the hosted session and lets a
 * reviewer approve or reject the latest `awaiting_approval` action, flipping both that
 * action's {@link sessionActivity.approvalStatus} and the session status in one
 * transaction. `contribute` is required to run a session or act on it.
 *
 * Beyond the run/replay surface this router exposes the contract's activity-scoped
 * review API (api-rpc-contract §3.11): `GET /:id/activity` (the paged ordered stream),
 * `POST /:id/activity/:activityId/approve` + `/reject` (decide a specific `proposed`
 * action — approve advances `proposed → approved → applied` and writes an
 * `audit_event`; `scope=all_in_session` decides every pending action at once; the
 * approval gate is an `assign`-level act per permissions §9.3),
 * `POST /:id/activity/:activityId/reply` (answer an `elicitation`, resuming an
 * `awaiting_input` session), and the lifecycle transitions
 * `POST /:id/{pause,resume,cancel}` (`contribute`).
 */
import { actor, agent, agentSession, auditEvent, db, sessionActivity, task } from '@docket/db';
import type { SessionActivityBody } from '@docket/db';
import {
  AgentSessionDetailOut,
  AgentSessionOut,
  pageOf,
  SessionActivityOut,
  SessionFromPromptBody,
  SessionReplyBody,
  SessionStatus,
} from '@docket/types';
import type { SessionApprovalDecision } from '@docket/types';
import type { SessionActionBody, SessionActivity } from '@docket/boundaries';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
import { ensureDefaultAgent } from '../lib/default-agent';
import { ok } from '../lib/ok';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type SessionRow = typeof agentSession.$inferSelect;
type ActivityRow = typeof sessionActivity.$inferSelect;

function toSessionOut(s: SessionRow): z.input<typeof AgentSessionOut> {
  return {
    id: s.id,
    organizationId: s.organizationId,
    agentId: s.agentId,
    taskId: s.taskId,
    trigger: s.trigger,
    status: s.status,
    initiatorId: s.initiatorId,
    externalRunRef: s.externalRunRef,
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

function toActivityOut(
  a: ActivityRow,
): z.input<typeof AgentSessionDetailOut>['activities'][number] {
  return {
    id: a.id,
    sessionId: a.sessionId,
    organizationId: a.organizationId,
    type: a.type,
    body: a.body,
    approvalStatus: a.approvalStatus,
    createdAt: a.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });
const activityParam = z.object({ id: z.string(), activityId: z.string() });
const listQuery = z.object({ status: SessionStatus.optional() });

/** Agent-sessions router: list (status filter), read with stream, approve + reject. */
const agentSessions = new Hono<AppEnv>()
  .get('/', zQuery(listQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { status } = c.req.valid('query');
    const where = status
      ? and(eq(agentSession.organizationId, orgId), eq(agentSession.status, status))
      : eq(agentSession.organizationId, orgId);
    const rows = await db
      .select()
      .from(agentSession)
      .where(where)
      .orderBy(desc(agentSession.createdAt));
    return ok(c, pageOf(AgentSessionOut), { items: rows.map(toSessionOut) });
  })
  .post('/', capabilityGuard('contribute'), zJson(SessionFromPromptBody), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { prompt, agentId } = c.req.valid('json');
    const settled = await createAndRunFromPrompt(orgId, actorId, prompt, agentId);
    return ok(c, AgentSessionOut, toSessionOut(settled));
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Session not found');
    const activities = await db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, id))
      .orderBy(asc(sessionActivity.createdAt));
    return ok(c, AgentSessionDetailOut, {
      ...toSessionOut(row),
      activities: activities.map(toActivityOut),
    });
  })
  .post(
    '/:id/run',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const settled = await runSession(orgId, id);
      return ok(c, AgentSessionOut, toSessionOut(settled));
    },
  )
  .get('/:id/stream', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const sessionRows = await db
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
      .limit(1);
    if (!sessionRows[0]) throw new NotFoundError('Session not found');
    const activities = await db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, id))
      .orderBy(asc(sessionActivity.createdAt));
    return streamSSE(c, async (stream) => {
      for (const activity of activities) {
        await stream.writeSSE({
          id: activity.id,
          event: activity.type,
          data: JSON.stringify(toActivityOut(activity)),
        });
      }
    });
  })
  .get('/:id/activity', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    await loadSession(orgId, id);
    const activities = await db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, id))
      .orderBy(asc(sessionActivity.createdAt));
    return ok(c, pageOf(SessionActivityOut), { items: activities.map(toActivityOut) });
  })
  .post(
    '/:id/activity/:activityId/approve',
    capabilityGuard('assign'),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await decideActivity(orgId, actorId, id, activityId, {
        decision: 'approve',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reject',
    capabilityGuard('assign'),
    zParam(activityParam),
    zJson(z.object({ scope: z.enum(['this', 'all_in_session']).optional() }).optional()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await decideActivity(orgId, actorId, id, activityId, {
        decision: 'reject',
        ...(body?.scope ? { scope: body.scope } : {}),
      });
      return ok(c, SessionActivityOut, toActivityOut(updated));
    },
  )
  .post(
    '/:id/activity/:activityId/reply',
    capabilityGuard('contribute'),
    zParam(activityParam),
    zJson(SessionReplyBody),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, activityId } = c.req.valid('param');
      const body = c.req.valid('json');
      const created = await replyToElicitation(orgId, id, activityId, body.body);
      return ok(c, SessionActivityOut, toActivityOut(created));
    },
  )
  .post('/:id/pause', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const updated = await transitionLifecycle(orgId, id, 'pause');
    return ok(c, AgentSessionOut, toSessionOut(updated));
  })
  .post('/:id/resume', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const updated = await transitionLifecycle(orgId, id, 'resume');
    return ok(c, AgentSessionOut, toSessionOut(updated));
  })
  .post('/:id/cancel', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const updated = await transitionLifecycle(orgId, id, 'cancel');
    return ok(c, AgentSessionOut, toSessionOut(updated));
  })
  .post(
    // Approving/rejecting an agent's proposed write is an `assign`-level act (permissions
    // §9.3; api-rpc-contract `POST /:sessionId/approvals/:activityId` → org:assign), the
    // same bar as the activity-scoped approval routes above. A contribute-only actor must
    // not clear an agent's gated action via this legacy session-level shortcut.
    '/:id/approve',
    capabilityGuard('assign'),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await resolveAction(orgId, id, 'approved');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  )
  .post(
    // See `/:id/approve`: rejecting a proposed action is likewise an `assign`-level act.
    '/:id/reject',
    capabilityGuard('assign'),
    zParam(idParam),
    zJson(z.object({})),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await resolveAction(orgId, id, 'rejected');
      return ok(c, AgentSessionOut, toSessionOut(updated));
    },
  );

/** Map one streamed {@link SessionActivity} to a persisted {@link SessionActivityBody}. */
function toActivityBody(activity: SessionActivity): SessionActivityBody {
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
async function createAndRunFromPrompt(
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
async function runSession(orgId: string, sessionId: string): Promise<SessionRow> {
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

/**
 * Flip the latest `awaiting_approval` action of a session to approved/rejected and
 * move the session forward (running on approve, canceled on reject), atomically.
 */
async function resolveAction(
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
 * Load an org-scoped session row or 404.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session to load.
 * @returns the session row.
 * @throws {NotFoundError} When no such session exists in the org.
 */
async function loadSession(orgId: string, sessionId: string): Promise<SessionRow> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Session not found');
  return row;
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
async function decideActivity(
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
        const [applied] = await tx
          .update(sessionActivity)
          .set({ approvalStatus: 'applied' })
          .where(eq(sessionActivity.id, action.id))
          .returning();
        /* v8 ignore next -- @preserve defensive: update always returns a row */
        if (!applied) throw new Error('activity update returned no row');
        if (action.id === activityId) decidedTarget = applied;
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
      const nextStatus = decision.decision === 'approve' ? 'running' : 'canceled';
      await tx
        .update(agentSession)
        .set({
          status: nextStatus,
          ...(nextStatus === 'canceled' ? { endedAt: new Date() } : {}),
        })
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
async function replyToElicitation(
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

/** A session lifecycle transition the reviewer may drive directly. */
type LifecycleAction = 'pause' | 'resume' | 'cancel';

/**
 * Drive a session lifecycle transition (contract §3.11 pause/resume/cancel).
 *
 * @remarks
 * Enforces the legal transitions:
 * - `pause`: only a `running` session → `awaiting_input`.
 * - `resume`: only an `awaiting_input` session → `running`.
 * - `cancel`: any non-terminal session (`pending`/`running`/`awaiting_input`/
 *   `awaiting_approval`) → `canceled` (stamping `endedAt`). Terminal states
 *   (`completed`/`failed`/`canceled`) cannot be canceled again.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session to transition.
 * @param action - The lifecycle action to apply.
 * @returns the updated session row.
 * @throws {NotFoundError} When the session is not found in the org.
 * @throws {ConflictError} When the transition is illegal from the current status.
 */
async function transitionLifecycle(
  orgId: string,
  sessionId: string,
  action: LifecycleAction,
): Promise<SessionRow> {
  const session = await loadSession(orgId, sessionId);

  let nextStatus: z.infer<typeof SessionStatus>;
  if (action === 'pause') {
    if (session.status !== 'running') throw new ConflictError('Session is not running');
    nextStatus = 'awaiting_input';
  } else if (action === 'resume') {
    if (session.status !== 'awaiting_input') {
      throw new ConflictError('Session is not awaiting input');
    }
    nextStatus = 'running';
  } else {
    const terminal: readonly z.infer<typeof SessionStatus>[] = ['completed', 'failed', 'canceled'];
    if (terminal.includes(session.status)) {
      throw new ConflictError('Session is already in a terminal state');
    }
    nextStatus = 'canceled';
  }

  const [updated] = await db
    .update(agentSession)
    .set({
      status: nextStatus,
      ...(nextStatus === 'canceled' ? { endedAt: new Date() } : {}),
    })
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .returning();
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!updated) throw new Error('session update returned no row');
  return updated;
}

export default agentSessions;
