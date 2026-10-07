/** Atomic draft persistence for legacy and revision-aware clients. */
import { dailyPlanDay, db } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { and, eq, sql } from 'drizzle-orm';
import { ConflictError } from '../error';

/** Save a draft only when the requested day revision still matches. */
export async function saveDailyDraft(input: {
  readonly hubId: string;
  readonly date: string;
  readonly draft: DailyPlanSnapshot;
  readonly resumeStep: string;
  readonly expectedRevision?: number;
}): Promise<typeof dailyPlanDay.$inferSelect> {
  if (input.expectedRevision !== undefined && input.expectedRevision > 0) {
    const [updated] = await db
      .update(dailyPlanDay)
      .set({
        draft: input.draft,
        resumeStep: input.resumeStep,
        revision: sql`${dailyPlanDay.revision} + 1`,
      })
      .where(
        and(
          eq(dailyPlanDay.hubId, input.hubId),
          eq(dailyPlanDay.date, input.date),
          eq(dailyPlanDay.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated) throw new ConflictError('The planning draft changed before saving');
    return updated;
  }
  const [row] = await db
    .insert(dailyPlanDay)
    .values({
      hubId: input.hubId,
      date: input.date,
      draft: input.draft,
      resumeStep: input.resumeStep,
      revision: 1,
    })
    .onConflictDoUpdate({
      target: [dailyPlanDay.hubId, dailyPlanDay.date],
      set: {
        draft: input.draft,
        resumeStep: input.resumeStep,
        revision: sql`${dailyPlanDay.revision} + 1`,
      },
      ...(input.expectedRevision !== undefined
        ? { setWhere: eq(dailyPlanDay.revision, input.expectedRevision) }
        : {}),
    })
    .returning();
  if (!row) {
    throw new ConflictError('The planning draft changed before saving');
  }
  return row;
}
