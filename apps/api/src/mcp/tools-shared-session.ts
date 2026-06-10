import { agentSession, db, sessionActivity } from '@docket/db';
import { and, desc, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';

/**
 * Flip the latest `awaiting_approval` action of a session and move it forward.
 *
 * @throws {NotFoundError} When the session is not found in the org.
 * @throws {ConflictError} When the session is not awaiting approval.
 */
export async function resolveSessionAction(
  orgId: string,
  sessionId: string,
  decision: 'approved' | 'rejected',
): Promise<typeof agentSession.$inferSelect> {
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
    /* v8 ignore next -- @preserve defensive: update always returns a row */
    if (!updated) throw new Error('session update returned no row');
    return updated;
  });
}

/**
 * Reply to an agent `elicitation` — append a human `response` and resume if waiting.
 *
 * @returns the resulting session status.
 * @throws {NotFoundError} When the session or elicitation is not found in the org.
 * @throws {ConflictError} When the referenced activity is not an `elicitation`.
 */
export async function replyToElicitation(
  orgId: string,
  sessionId: string,
  activityId: string,
  text: string,
): Promise<string> {
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
    if (prompt.type !== 'elicitation') throw new ConflictError('Activity is not an elicitation');

    await tx
      .insert(sessionActivity)
      .values({ sessionId, organizationId: orgId, type: 'response', body: { text } });

    let nextStatus = session.status;
    if (session.status === 'awaiting_input') {
      nextStatus = 'running';
      await tx
        .update(agentSession)
        .set({ status: 'running' })
        .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)));
    }
    return nextStatus;
  });
}

/**
 * Cancel a non-terminal agent session (stamps `endedAt`).
 *
 * @throws {NotFoundError} When the session is not found in the org.
 * @throws {ConflictError} When the session is already in a terminal state.
 */
export async function cancelSession(
  orgId: string,
  sessionId: string,
): Promise<typeof agentSession.$inferSelect> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const session = rows[0];
  if (!session) throw new NotFoundError('Session not found');
  const terminal = ['completed', 'failed', 'canceled'];
  if (terminal.includes(session.status)) {
    throw new ConflictError('Session is already in a terminal state');
  }
  const [updated] = await db
    .update(agentSession)
    .set({ status: 'canceled', endedAt: new Date() })
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .returning();
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!updated) throw new Error('session update returned no row');
  return updated;
}
