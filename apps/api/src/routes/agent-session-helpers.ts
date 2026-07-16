import { agentSession, db, sessionActivity } from '@docket/db';
import { type Capability, satisfies } from '@docket/authz';
import type { AgentSessionDetailOut, AgentSessionOut } from '@docket/types';
import { SessionStatus } from '@docket/types';
import { and, desc, eq, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, CapabilityError, ConflictError, NotFoundError } from '../error';

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

/** List caller-visible personal Athena and shared registered-agent sessions. */
export async function listSessionAccess(
  c: Context<AppEnv>,
  status?: z.infer<typeof SessionStatus>,
): Promise<SessionRow[]> {
  const userId = requestUserId(c);
  const { orgId } = c.get('actorCtx');
  const ownership = or(
    and(eq(agentSession.executorKind, 'athena'), eq(agentSession.ownerUserId, userId)),
    and(eq(agentSession.executorKind, 'registered_agent'), eq(agentSession.organizationId, orgId)),
  );
  return db
    .select()
    .from(agentSession)
    .where(status ? and(ownership, eq(agentSession.status, status)) : ownership)
    .orderBy(desc(agentSession.createdAt));
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

/** toActivityOut converts internal API route data into the public API response shape. */
export function toActivityOut(
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
): Promise<SessionRow> {
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
    .where(eq(agentSession.id, session.id))
    .returning();
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!updated) throw new Error('session update returned no row');
  return updated;
}
