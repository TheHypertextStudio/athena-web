/** Durable, owner-only chapter spans for the one personal Athena conversation. */
import { agentSession, athenaConversationChapter, db, sessionActivity } from '@docket/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';

/** One marked span, whose end is absent while the person is still marking it. */
export const AthenaChapterOut = z.object({
  id: z.string(),
  title: z.string(),
  startActivityId: z.string(),
  endActivityId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** All marked spans of the current conversation. */
export const AthenaChaptersOut = z.object({
  sessionId: z.string(),
  items: z.array(AthenaChapterOut),
});

/** A new chapter begins at one visible message. */
export const AthenaChapterStart = z.object({
  startActivityId: z.string().min(1),
  title: z.string().trim().min(1).max(80),
});

/** A chapter ends at a later visible message. */
export const AthenaChapterEnd = z.object({ endActivityId: z.string().min(1) });

/** Serialize a stored chapter without exposing its ownership columns. */
function chapterOut(
  row: typeof athenaConversationChapter.$inferSelect,
): z.infer<typeof AthenaChapterOut> {
  return {
    id: row.id,
    title: row.title,
    startActivityId: row.startActivityId,
    endActivityId: row.endActivityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Find a visible message in the current conversation, rejecting foreign or hidden activity. */
async function chapterMessage(sessionId: string, activityId: string) {
  const [activity] = await db
    .select()
    .from(sessionActivity)
    .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
    .limit(1);
  if (activity?.type !== 'response') throw new NotFoundError('Message not found');
  return activity;
}

/** Return the caller's chapters for a canonical conversation. */
export async function listAthenaChapters(ownerUserId: string, sessionId: string) {
  const rows = await db
    .select()
    .from(athenaConversationChapter)
    .where(
      and(
        eq(athenaConversationChapter.ownerUserId, ownerUserId),
        eq(athenaConversationChapter.sessionId, sessionId),
      ),
    )
    .orderBy(asc(athenaConversationChapter.createdAt));
  return { sessionId, items: rows.map(chapterOut) };
}

/** Start one chapter after validating its anchor and the open-chapter invariant. */
export async function startAthenaChapter(
  ownerUserId: string,
  sessionId: string,
  input: z.infer<typeof AthenaChapterStart>,
) {
  await chapterMessage(sessionId, input.startActivityId);
  return db.transaction(async (tx) => {
    await tx
      .select({ id: agentSession.id })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId))
      .for('update');
    const [open] = await tx
      .select({ id: athenaConversationChapter.id })
      .from(athenaConversationChapter)
      .where(
        and(
          eq(athenaConversationChapter.sessionId, sessionId),
          eq(athenaConversationChapter.ownerUserId, ownerUserId),
          isNull(athenaConversationChapter.endActivityId),
        ),
      )
      .limit(1);
    if (open) throw new ConflictError('End the current chapter first');
    const [created] = await tx
      .insert(athenaConversationChapter)
      .values({
        sessionId,
        ownerUserId,
        startActivityId: input.startActivityId,
        title: input.title,
      })
      .returning();
    if (!created) throw new Error('chapter insert returned no row');
    return chapterOut(created);
  });
}

/** Close the caller's open chapter at a message that follows its start. */
export async function endAthenaChapter(
  ownerUserId: string,
  sessionId: string,
  chapterId: string,
  endActivityId: string,
) {
  const end = await chapterMessage(sessionId, endActivityId);
  const [chapter] = await db
    .select()
    .from(athenaConversationChapter)
    .where(
      and(
        eq(athenaConversationChapter.id, chapterId),
        eq(athenaConversationChapter.sessionId, sessionId),
        eq(athenaConversationChapter.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  if (!chapter) throw new NotFoundError('Chapter not found');
  if (chapter.endActivityId) throw new ConflictError('Chapter already ended');
  const start = await chapterMessage(sessionId, chapter.startActivityId);
  if (
    end.createdAt < start.createdAt ||
    (end.createdAt.getTime() === start.createdAt.getTime() && end.id <= start.id)
  ) {
    throw new ConflictError('The end must follow the start');
  }
  const [updated] = await db
    .update(athenaConversationChapter)
    .set({ endActivityId })
    .where(
      and(
        eq(athenaConversationChapter.id, chapterId),
        isNull(athenaConversationChapter.endActivityId),
      ),
    )
    .returning();
  if (!updated) throw new ConflictError('Chapter already ended');
  return chapterOut(updated);
}

/** Remove a chapter marker without touching its messages or work. */
export async function deleteAthenaChapter(
  ownerUserId: string,
  sessionId: string,
  chapterId: string,
) {
  const [deleted] = await db
    .delete(athenaConversationChapter)
    .where(
      and(
        eq(athenaConversationChapter.id, chapterId),
        eq(athenaConversationChapter.sessionId, sessionId),
        eq(athenaConversationChapter.ownerUserId, ownerUserId),
      ),
    )
    .returning({ id: athenaConversationChapter.id });
  if (!deleted) throw new NotFoundError('Chapter not found');
  return { deleted: true };
}
