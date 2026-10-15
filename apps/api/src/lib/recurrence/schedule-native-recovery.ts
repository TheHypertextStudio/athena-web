import {
  processOccurrence,
  recurrenceSeries,
  recurrenceSeriesRevision,
  type Database,
} from '@docket/db';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { advanceNativeScheduleOccurrence } from './schedule-native-completion';

/** Recover at most 100 completed native runs after resume or a sweep; persisted source keys prevent duplicates.
 * @returns The number of applied continuations resolved during this bounded pass; failed attempts remain explicit retries.
 */
export async function recoverNativeScheduleContinuations(
  database: Database,
  input: { readonly organizationId: string; readonly seriesId: string },
): Promise<number> {
  const sources = await database
    .select({ id: processOccurrence.id })
    .from(processOccurrence)
    .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, processOccurrence.seriesId))
    .innerJoin(
      recurrenceSeriesRevision,
      eq(recurrenceSeriesRevision.id, processOccurrence.seriesRevisionId),
    )
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
        eq(recurrenceSeries.status, 'active'),
        isNull(recurrenceSeries.archivedAt),
        eq(processOccurrence.status, 'completed'),
        isNotNull(processOccurrence.completedAt),
        isNotNull(processOccurrence.acceptedClaim),
        isNotNull(processOccurrence.blueprintAppliedAt),
        eq(recurrenceSeriesRevision.triggerKind, 'after_completion'),
        sql`not exists (select 1 from process_occurrence successor where successor.organization_id = ${input.organizationId} and successor.continued_from_occurrence_id = ${processOccurrence.id})`,
      ),
    )
    .orderBy(asc(processOccurrence.completedAt), asc(processOccurrence.id))
    .limit(100);
  let recovered = 0;
  for (const source of sources) {
    const result = await advanceNativeScheduleOccurrence(database, {
      ...input,
      occurrenceId: source.id,
    });
    if (!result.nextOccurrenceId) continue;
    const [applied] = await database
      .select({ id: processOccurrence.id })
      .from(processOccurrence)
      .where(
        and(
          eq(processOccurrence.organizationId, input.organizationId),
          eq(processOccurrence.id, result.nextOccurrenceId),
          isNotNull(processOccurrence.blueprintAppliedAt),
        ),
      )
      .limit(1);
    if (applied) recovered += 1;
  }
  return recovered;
}
