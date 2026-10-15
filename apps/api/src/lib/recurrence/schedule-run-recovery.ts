import type { processOccurrence } from '@docket/db';
/** The same eligibility drives history actions and the canonical retry service. */
export function canRetryScheduleOccurrence(
  row: Pick<
    typeof processOccurrence.$inferSelect,
    'runKind' | 'status' | 'seriesId' | 'seriesRevisionId' | 'blueprintAppliedAt'
  >,
): boolean {
  return (
    row.runKind === 'scheduled' &&
    row.seriesId !== null &&
    row.seriesRevisionId !== null &&
    row.blueprintAppliedAt === null &&
    ['failed', 'needs_resolution'].includes(row.status)
  );
}
