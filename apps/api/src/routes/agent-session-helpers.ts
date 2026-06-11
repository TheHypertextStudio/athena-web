import type { sessionActivity } from '@docket/db';
import { agentSession, db } from '@docket/db';
import type { AgentSessionDetailOut, AgentSessionOut } from '@docket/types';
import { SessionStatus } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';

export type SessionRow = typeof agentSession.$inferSelect;
export type ActivityRow = typeof sessionActivity.$inferSelect;

export function toSessionOut(s: SessionRow): z.input<typeof AgentSessionOut> {
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

export const idParam = z.object({ id: z.string() });
export const activityParam = z.object({ id: z.string(), activityId: z.string() });
export const listQuery = z.object({ status: SessionStatus.optional() });

/** Load an org-scoped session row or throw {@link NotFoundError}. */
export async function loadSession(orgId: string, sessionId: string): Promise<SessionRow> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Session not found');
  return row;
}

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
