/** Post-call review, notification, and conflict-safe Undo for Athena phone calls. */
import { changeSet, db, notification, voiceSession } from '@docket/db';
import type { PhoneCallSummaryOut } from '@docket/athena/voice';
import { and, asc, eq, sql } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { undoChangeSetAtomically } from '../mcp/change-set';

type PhoneCallSummary = PhoneCallSummaryOut;

/** Load one caller-owned phone call and only the change sets created by that call. */
export async function loadPhoneCallSummary(
  userId: string,
  voiceSessionId: string,
): Promise<PhoneCallSummary> {
  const [session] = await db
    .select({
      id: voiceSession.id,
      conversationId: voiceSession.conversationId,
      startedAt: voiceSession.startedAt,
      endedAt: voiceSession.endedAt,
    })
    .from(voiceSession)
    .where(
      and(
        eq(voiceSession.id, voiceSessionId),
        eq(voiceSession.userId, userId),
        eq(voiceSession.channel, 'phone'),
      ),
    )
    .limit(1);
  if (!session) throw new NotFoundError('Phone call not found');

  const rows = await db
    .select({
      id: changeSet.id,
      summary: changeSet.summary,
      origin: changeSet.origin,
      createdAt: changeSet.createdAt,
      undoneAt: changeSet.undoneAt,
    })
    .from(changeSet)
    .where(sql`${changeSet.origin}->>'sessionId' = ${voiceSessionId}`)
    .orderBy(asc(changeSet.createdAt));
  const changes: PhoneCallSummary['changes'] = [];
  for (const row of rows) {
    const tool = row.origin.tool;
    if (tool !== 'create_task' && tool !== 'complete_task') continue;
    changes.push({
      changeSetId: row.id,
      summary: row.summary,
      tool,
      createdAt: row.createdAt.toISOString(),
      undoneAt: row.undoneAt?.toISOString() ?? null,
      undoAvailable: row.undoneAt === null,
    });
  }
  return {
    voiceSessionId: session.id,
    conversationId: session.conversationId,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    changes,
  };
}

/** Publish one idempotent authenticated inbox notification after a phone call ends. */
export async function publishPhoneCallSummary(voiceSessionId: string): Promise<void> {
  const [session] = await db
    .select({
      id: voiceSession.id,
      userId: voiceSession.userId,
      organizationId: voiceSession.organizationId,
      channel: voiceSession.channel,
    })
    .from(voiceSession)
    .where(eq(voiceSession.id, voiceSessionId))
    .limit(1);
  if (session?.channel !== 'phone') return;

  const summary = await loadPhoneCallSummary(session.userId, session.id);
  const count = summary.changes.length;
  const title = count === 0 ? 'Athena phone call ended' : 'Athena updated your tasks by phone';
  const detail =
    count === 0
      ? 'No tasks changed during this call.'
      : count === 1
        ? summary.changes[0]?.summary
        : `${String(count)} task changes are ready to review.`;
  await db
    .insert(notification)
    .values({
      id: `phone_call_${session.id}`,
      userId: session.userId,
      organizationId: session.organizationId,
      type: 'phone_call',
      body: {
        title,
        summary: detail,
        url: `/athena?session=${encodeURIComponent(summary.conversationId)}&call=${encodeURIComponent(session.id)}`,
        voiceSessionId: session.id,
        changes: summary.changes,
        action: count === 1 ? 'undo' : count > 1 ? 'review' : 'open',
      },
    })
    .onConflictDoNothing({ target: notification.id });
}

/** Undo one change only when the signed-in caller owns the call and no later edit conflicts. */
export async function undoPhoneCallChange(
  userId: string,
  voiceSessionId: string,
  changeSetId: string,
): Promise<void> {
  const summary = await loadPhoneCallSummary(userId, voiceSessionId);
  const change = summary.changes.find((candidate) => candidate.changeSetId === changeSetId);
  if (change?.undoAvailable !== true) throw new NotFoundError('Phone call change not found');

  const [session] = await db
    .select({ organizationId: voiceSession.organizationId })
    .from(voiceSession)
    .where(and(eq(voiceSession.id, voiceSessionId), eq(voiceSession.userId, userId)))
    .limit(1);
  if (!session?.organizationId) throw new NotFoundError('Phone call change not found');
  await undoChangeSetAtomically(session.organizationId, changeSetId);
}
