import { processOccurrence, type Database } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { ConflictError } from '../../error';
import { requireScheduleAccess, type ScheduleAccessRequest } from './schedule-access';
/**
 * Record a person's reviewed missed-run decision before the canonical executor can claim it.
 * @throws For revoked actual-scope management or a changed run/revision/decision; nothing commits.
 */
export async function resolveMissedScheduleOccurrence(
  database: Database,
  input: ScheduleAccessRequest & {
    readonly occurrenceId: string;
    readonly seriesRevisionId: string;
  },
): Promise<void> {
  await database.transaction(async (tx) => {
    await requireScheduleAccess(tx, input, 'manage');
    const [row] = await tx
      .update(processOccurrence)
      .set({ status: 'expected', resolvedAt: new Date() })
      .where(
        and(
          eq(processOccurrence.id, input.occurrenceId),
          eq(processOccurrence.organizationId, input.organizationId),
          eq(processOccurrence.seriesId, input.seriesId),
          eq(processOccurrence.seriesRevisionId, input.seriesRevisionId),
          eq(processOccurrence.runKind, 'scheduled'),
          eq(processOccurrence.status, 'needs_resolution'),
          isNull(processOccurrence.blueprintAppliedAt),
        ),
      )
      .returning({ id: processOccurrence.id });
    if (!row) throw new ConflictError('The schedule decision changed.');
  });
}
