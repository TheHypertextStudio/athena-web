import { recurrenceSeries, type Database } from '@docket/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { RecurrenceSeriesOut } from '../../contracts/recurrence';
import { NotFoundError } from '../../error';
import { encodeIdCursor, seekAfterId } from '../list-cursor';
import { requireScheduleAccess, type ScheduleAccessRequest } from './schedule-access';
import { loadRecurrenceSeries } from './series';

/** Legacy transport aliases never bypass a schedule's current private-scope permissions. */
export async function requireCanonicalRecurrenceAccess(
  database: Database,
  input: ScheduleAccessRequest,
  access: 'view' | 'manage',
): Promise<void> {
  await requireScheduleAccess(database, input, access);
}
async function visibleCompatibilitySeries(
  database: Database,
  input: ScheduleAccessRequest,
): Promise<z.input<typeof RecurrenceSeriesOut> | null> {
  try {
    await requireScheduleAccess(database, input);
    return await loadRecurrenceSeries(database, input.organizationId, input.seriesId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
/** Fill legacy pages with currently visible schedules while preserving historical aliases. */
export async function listCompatibleRecurrenceSeries(
  database: Database,
  input: Omit<ScheduleAccessRequest, 'seriesId'> & {
    readonly cursor?: string | undefined;
    readonly limit: number;
  },
): Promise<z.input<typeof RecurrenceSeriesOut>[]> {
  const visible: z.input<typeof RecurrenceSeriesOut>[] = [];
  let cursor = input.cursor;
  while (visible.length <= input.limit) {
    const rows = await database
      .select({ id: recurrenceSeries.id })
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.organizationId, input.organizationId),
          isNull(recurrenceSeries.archivedAt),
          seekAfterId(recurrenceSeries.id, cursor, 'asc'),
        ),
      )
      .orderBy(asc(recurrenceSeries.id))
      .limit(100);
    for (const row of rows) {
      const item = await visibleCompatibilitySeries(database, { ...input, seriesId: row.id });
      if (item) visible.push(item);
      if (visible.length > input.limit) break;
    }
    if (rows.length < 100 || visible.length > input.limit) break;
    const last = rows.at(-1);
    if (!last) break;
    cursor = encodeIdCursor(last.id);
  }
  return visible;
}
