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
 */
import { actor, agent, agentSession, db, sessionActivity, task } from '@docket/db';
import type { SessionActivityBody } from '@docket/db';
import { AgentSessionDetailOut, AgentSessionOut, pageOf, SessionStatus } from '@docket/types';
import type { SessionActionBody, SessionActivity } from '@docket/boundaries';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { ConflictError, NotFoundError } from '../error';
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
  .post(
    '/:id/approve',
    capabilityGuard('contribute'),
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
    '/:id/reject',
    capabilityGuard('contribute'),
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

  let taskBrief = sessionId;
  if (session.taskId) {
    const taskRows = await db
      .select({ title: task.title })
      .from(task)
      .where(and(eq(task.id, session.taskId), eq(task.organizationId, orgId)))
      .limit(1);
    if (taskRows[0]) taskBrief = taskRows[0].title;
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

export default agentSessions;
