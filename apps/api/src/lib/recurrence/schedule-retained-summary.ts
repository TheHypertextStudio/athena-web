import { processOccurrence, type Database, type recurrenceSeriesRevision } from '@docket/db';
import type { WorkScheduleUsedTemplate } from '@docket/work/work-schedule-management';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

/** Read the newest accepted root for this exact revision, otherwise its independently guarded fallback. */
export async function retainedScheduleTemplate(
  database: Database,
  organizationId: string,
  revision: typeof recurrenceSeriesRevision.$inferSelect,
): Promise<WorkScheduleUsedTemplate | null> {
  if (revision.scheduleDraft?.kind !== 'schedule') return null;
  const [accepted] = await database
    .select({ claim: processOccurrence.acceptedClaim })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesRevisionId, revision.id),
        eq(processOccurrence.seriesId, revision.seriesId),
        isNotNull(processOccurrence.acceptedClaim),
      ),
    )
    .orderBy(desc(processOccurrence.acceptanceOrdinal))
    .limit(1);
  const roots = accepted?.claim?.roots ?? revision.authoringFallback?.roots;
  const root = roots?.length === 1 ? roots[0] : null;
  return root ? { workTypeId: root.workTypeId, workTypeVersionId: root.versionId } : null;
}
