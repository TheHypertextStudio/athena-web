import { agentSession, agentSessionRun, db, sessionActivity, task } from '@docket/db';
import { type Capability, satisfies } from '@docket/authz';
import type { AgentSessionDetailOut, AgentSessionOut } from '@docket/athena/agent-contract';
import { parseMcpAppPresentation } from '@docket/integrations/mcp-apps-contract';
import { SessionStatus } from '@docket/athena/agent-contract';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { persistWaitingAthenaWake } from '../agent/async-runner';
import { AuthError, CapabilityError, ConflictError, NotFoundError } from '../error';

import { buildTaskViewFilter } from './task-helpers';

/** SessionRow is the selected database row shape consumed by these API route serializers. */
export type SessionRow = typeof agentSession.$inferSelect;
/** ActivityRow is the selected database row shape consumed by these API route serializers. */
export type ActivityRow = typeof sessionActivity.$inferSelect;

/** The result of discriminating one compatibility-route session by executor kind. */
export interface SessionAccess {
  /** The visible persisted session. */
  readonly session: SessionRow;
  /** The request-authenticated user, never a body or path value. */
  readonly userId: string;
}

/** Return the authenticated caller id used for every personal Athena ownership check. */
export function requestUserId(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/**
 * Load a session visible through an organization compatibility route.
 *
 * @remarks
 * Athena is visible only to its persisted owner, using the request session as identity. Its
 * optional workspace context never participates in ownership. Registered agents retain the old
 * workspace boundary and, for mutations, the requested ranked capability. All failed ownership or
 * workspace checks return the same existence-hiding 404.
 *
 * @param c - The authenticated organization-route request context.
 * @param sessionId - The session being addressed.
 * @param registeredCapability - Capability required only for a registered-agent mutation.
 * @returns The visible session and authenticated user id.
 */
export async function loadSessionAccess(
  c: Context<AppEnv>,
  sessionId: string,
  registeredCapability?: Capability,
): Promise<SessionAccess> {
  const userId = requestUserId(c);
  const { orgId, capabilities } = c.get('actorCtx');
  const rows = await db.select().from(agentSession).where(eq(agentSession.id, sessionId)).limit(1);
  const session = rows[0];
  if (!session) throw new NotFoundError('Session not found');

  if (session.executorKind === 'athena') {
    if (session.ownerUserId !== userId) throw new NotFoundError('Session not found');
    return { session, userId };
  }
  if (session.organizationId !== orgId) throw new NotFoundError('Session not found');
  if (
    registeredCapability &&
    !(capabilities as Capability[]).some((held) => satisfies(held, registeredCapability))
  ) {
    throw new CapabilityError();
  }
  return { session, userId };
}

/**
 * Filter registered sessions whose linked task is not visible to the active human caller.
 *
 * @remarks
 * Taskless registered sessions deliberately preserve their existing organization-membership
 * delivery policy. Athena sessions keep their owner-only policy. Only registered sessions with a
 * task link are reduced through the canonical task visibility predicate, in bulk, so the list
 * endpoint does not perform one grant lookup per session.
 */
async function filterRegisteredTaskSessionDelivery(
  orgId: string,
  actorId: string,
  sessions: readonly SessionRow[],
): Promise<SessionRow[]> {
  const taskIds = [
    ...new Set(
      sessions.flatMap((session) =>
        session.executorKind === 'registered_agent' && session.taskId !== null
          ? [session.taskId]
          : [],
      ),
    ),
  ];
  if (taskIds.length === 0) return [...sessions];

  const canViewTask = await buildTaskViewFilter(orgId, actorId);
  const taskRows = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(and(eq(task.organizationId, orgId), inArray(task.id, taskIds)));
  const visibleTaskIds = new Set(taskRows.filter(canViewTask).map((row) => row.id));
  return sessions.filter(
    (session) =>
      session.executorKind !== 'registered_agent' ||
      session.taskId === null ||
      visibleTaskIds.has(session.taskId),
  );
}

/**
 * Load a session that may be delivered to the caller.
 *
 * @remarks
 * This keeps transcript-bearing registered sessions on the same task boundary as normal task
 * delivery while preserving {@link loadSessionAccess}'s existing mutation compatibility policy.
 * A task-bound registered session without current task visibility is existence-hidden.
 *
 * @param c - The authenticated organization-route request context.
 * @param sessionId - The session being delivered.
 * @returns The visible session and authenticated user id.
 */
export async function loadSessionDeliveryAccess(
  c: Context<AppEnv>,
  sessionId: string,
): Promise<SessionAccess> {
  const access = await loadSessionAccess(c, sessionId);
  if (!(await canContinueSessionDelivery(c, access.session))) {
    throw new NotFoundError('Session not found');
  }
  return access;
}

/**
 * Re-evaluate whether an already-authorized session can still deliver activity payloads.
 *
 * @remarks
 * SSE is long-lived, so its initial authorization is not enough when a task grant can be
 * revoked mid-stream. Callers that already passed {@link loadSessionAccess} use this immediately
 * before an activity write. Athena ownership and taskless registered-session membership remain
 * established by that initial check; only task-bound registered sessions need the current
 * canonical task predicate.
 *
 * @param c - The authenticated organization-route request context.
 * @param session - The session originally authorized for delivery.
 * @returns Whether activity delivery remains allowed at this instant.
 */
export async function canContinueSessionDelivery(
  c: Context<AppEnv>,
  session: SessionRow,
): Promise<boolean> {
  if (session.executorKind !== 'registered_agent' || session.taskId === null) return true;
  const { orgId, actorId } = c.get('actorCtx');
  const visible = await filterRegisteredTaskSessionDelivery(orgId, actorId, [session]);
  return visible.length === 1;
}

/** List caller-visible personal Athena and shared registered-agent sessions. */
export async function listSessionAccess(
  c: Context<AppEnv>,
  status?: z.infer<typeof SessionStatus>,
): Promise<SessionRow[]> {
  const userId = requestUserId(c);
  const { orgId, actorId } = c.get('actorCtx');
  const ownership = or(
    and(eq(agentSession.executorKind, 'athena'), eq(agentSession.ownerUserId, userId)),
    and(eq(agentSession.executorKind, 'registered_agent'), eq(agentSession.organizationId, orgId)),
  );
  const sessions = await db
    .select()
    .from(agentSession)
    .where(status ? and(ownership, eq(agentSession.status, status)) : ownership)
    .orderBy(desc(agentSession.createdAt));
  return filterRegisteredTaskSessionDelivery(orgId, actorId, sessions);
}

/** toSessionOut converts internal API route data into the public API response shape. */
export function toSessionOut(s: SessionRow): z.input<typeof AgentSessionOut> {
  const common = {
    id: s.id,
    taskId: s.taskId,
    trigger: s.trigger,
    status: s.status,
    initiatorId: s.initiatorId,
    externalRunRef: s.externalRunRef,
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
  if (s.executorKind === 'athena') {
    if (s.ownerUserId === null || s.organizationId !== null || s.agentId !== null) {
      throw new Error('Athena session violates its executor ownership contract');
    }
    return {
      ...common,
      executorKind: 'athena',
      organizationId: null,
      contextOrganizationId: s.contextOrganizationId,
      agentId: null,
      ownerUserId: s.ownerUserId,
    };
  }
  if (s.organizationId === null || s.agentId === null || s.ownerUserId !== null) {
    throw new Error('Registered-agent session violates its executor ownership contract');
  }
  return {
    ...common,
    executorKind: 'registered_agent',
    organizationId: s.organizationId,
    contextOrganizationId: null,
    agentId: s.agentId,
    ownerUserId: null,
  };
}

/**
 * Re-validate a persisted MCP app presentation before it leaves the API.
 *
 * @remarks
 * The agent loop only ever writes presentations that passed `parseMcpAppPresentation` at capture
 * time, but the row is durable and the parser's bounds (JSON safety, size cap, credential scan)
 * are the read-side contract too — the same validated-on-read posture the personal activity route
 * takes. A raw value that no longer parses is stripped and reported as unavailable rather than
 * relayed. Everything else in the body — the approval gate's `toolCall.input` above all — passes
 * through untouched.
 */
function bodyWithValidatedPresentation(body: ActivityRow['body']): ActivityRow['body'] {
  const action = body.action;
  const result = action?.result;
  if (
    !action ||
    !result ||
    (result.presentation === undefined && result.modelContext === undefined)
  ) {
    return body;
  }
  // `modelContext` and its delivery flag are the agent loop's private storage — they never leave
  // the process, on any surface.
  const {
    presentation: raw,
    modelContext: _context,
    modelContextDelivered: _delivered,
    ...rest
  } = result;
  const presentation = parseMcpAppPresentation(raw);
  return {
    ...body,
    action: {
      ...action,
      result: presentation
        ? { ...rest, presentation }
        : raw === undefined
          ? rest
          : { ...rest, presentationUnavailable: true },
    },
  };
}

/** toActivityOut converts internal API route data into the public API response shape. */
export function toActivityOut(
  a: ActivityRow,
): z.input<typeof AgentSessionDetailOut>['activities'][number] {
  return {
    id: a.id,
    sessionId: a.sessionId,
    organizationId: a.organizationId,
    type: a.type,
    body: bodyWithValidatedPresentation(a.body),
    // `executing` is an internal non-repeatable dispatch claim. Compatibility clients see the
    // existing non-terminal `approved` state while the session itself is parked for attention.
    approvalStatus: a.approvalStatus === 'executing' ? 'approved' : a.approvalStatus,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Load one activity of an org-scoped session, or 404.
 *
 * @remarks
 * Used by the approval routes to return the activity's FINAL state after the
 * decide → execute → resume composition ran (the decide-time row is stale by then).
 */
export async function loadActivity(sessionId: string, activityId: string): Promise<ActivityRow> {
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Activity not found');
  return rows[0];
}

/** idParam is the reusable OpenAPI parameter schema for this API route route. */
export const idParam = z.object({ id: z.string() });
/** activityParam is the reusable OpenAPI parameter schema for this API route route. */
export const activityParam = z.object({ id: z.string(), activityId: z.string() });
/** listQuery is the reusable OpenAPI query schema for this API route route. */
export const listQuery = z.object({ status: SessionStatus.optional() });

/** A session lifecycle transition the reviewer may drive directly. */
export type LifecycleAction = 'pause' | 'resume' | 'cancel';

/** Durable continuation effects that must commit with a lifecycle transition. */
export interface LifecycleTransitionOptions {
  /** Persist a wake for the latest waiting Athena generation in the same transaction. */
  readonly queueWake?: boolean;
}

/**
 * Drive a session lifecycle transition (contract §3.11 pause/resume/cancel).
 *
 * @remarks
 * Legal transitions: `pause` running→awaiting_input; `resume` awaiting_input→running;
 * `cancel` any non-terminal session→canceled (stamping `endedAt`).
 *
 * @throws {NotFoundError} When the session is not found.
 * @throws {ConflictError} When the transition is illegal.
 */
export async function transitionLifecycle(
  session: SessionRow,
  action: LifecycleAction,
  options: LifecycleTransitionOptions = {},
): Promise<SessionRow> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, session.id))
      .for('update');
    if (!current) throw new NotFoundError('Session not found');

    let nextStatus: z.infer<typeof SessionStatus>;
    if (action === 'pause') {
      if (current.status !== 'running') throw new ConflictError('Session is not running');
      nextStatus = 'awaiting_input';
    } else if (action === 'resume') {
      if (current.status !== 'awaiting_input') {
        throw new ConflictError('Session is not awaiting input');
      }
      nextStatus = 'running';
    } else {
      const terminal: readonly z.infer<typeof SessionStatus>[] = [
        'completed',
        'failed',
        'canceled',
      ];
      if (terminal.includes(current.status)) {
        throw new ConflictError('Session is already in a terminal state');
      }
      nextStatus = 'canceled';
    }

    const [latestRun] =
      current.executorKind === 'athena'
        ? await tx
            .select()
            .from(agentSessionRun)
            .where(eq(agentSessionRun.sessionId, current.id))
            .orderBy(desc(agentSessionRun.generation))
            .limit(1)
            .for('update')
        : [];
    const now = new Date();

    if (latestRun && action === 'pause' && latestRun.status !== 'waiting') {
      if (
        latestRun.status === 'queued' ||
        latestRun.status === 'running' ||
        latestRun.status === 'completed'
      ) {
        await tx
          .update(agentSessionRun)
          .set({
            status: 'waiting',
            leaseToken: null,
            leaseExpiresAt: null,
            completedAt: now,
          })
          .where(eq(agentSessionRun.id, latestRun.id));
      }
    }

    if (latestRun && action === 'cancel') {
      if (latestRun.status === 'waiting') {
        await persistWaitingAthenaWake(tx, current.id, now);
      } else if (
        latestRun.status === 'queued' ||
        latestRun.status === 'running' ||
        latestRun.status === 'completed'
      ) {
        await tx
          .update(agentSessionRun)
          .set({
            status: 'canceled',
            leaseToken: null,
            leaseExpiresAt: null,
            completedAt: now,
          })
          .where(eq(agentSessionRun.id, latestRun.id));
      }
    }

    const [updated] = await tx
      .update(agentSession)
      .set({
        status: nextStatus,
        ...(nextStatus === 'canceled' ? { endedAt: now } : {}),
      })
      .where(eq(agentSession.id, current.id))
      .returning();
    /* v8 ignore next -- @preserve defensive: update always returns a row */
    if (!updated) throw new Error('session update returned no row');
    if (options.queueWake && latestRun?.status !== 'waiting') {
      await persistWaitingAthenaWake(tx, current.id, now);
    }
    return updated;
  });
}
