import {
  processOccurrence,
  recurrenceException,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
  type Database,
} from '@docket/db';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { triggerFromStorage } from './series';
import {
  nextCalendarScheduleDate,
  scheduleCivilToday,
  type ScheduleDateSegment,
} from './schedule-review-date';

/** Prefer durable expected work; otherwise inspect all active revision segments and their exceptions. */
export async function nextScheduleRunDate(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<string | null> {
  const revisions = await database
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.organizationId, organizationId),
        eq(recurrenceSeriesRevision.seriesId, seriesId),
      ),
    )
    .orderBy(asc(recurrenceSeriesRevision.effectiveFrom), asc(recurrenceSeriesRevision.number));
  const ids = revisions.map((revision) => revision.id);
  if (!ids.length) return null;
  const [weekdays, edits] = await Promise.all([
    database
      .select()
      .from(recurrenceSeriesWeekday)
      .where(inArray(recurrenceSeriesWeekday.seriesRevisionId, ids)),
    database
      .select()
      .from(recurrenceException)
      .where(
        and(
          eq(recurrenceException.organizationId, organizationId),
          inArray(recurrenceException.seriesRevisionId, ids),
        ),
      ),
  ]);
  const segments = revisions.map((revision): ScheduleDateSegment => {
    const exceptions = edits.filter((edit) => edit.seriesRevisionId === revision.id);
    return {
      effectiveFrom: revision.effectiveFrom,
      trigger: triggerFromStorage(
        revision,
        weekdays.filter((row) => row.seriesRevisionId === revision.id).map((row) => row.weekday),
      ),
      exceptions: {
        exclude: exceptions
          .filter((edit) => edit.kind === 'exclude')
          .map((edit) => edit.scheduledFor),
        include: exceptions
          .filter((edit) => edit.kind === 'include')
          .map((edit) => edit.scheduledFor),
        reschedule: exceptions.flatMap((edit) =>
          edit.kind === 'reschedule' && edit.replacementDate
            ? [{ from: edit.scheduledFor, to: edit.replacementDate }]
            : [],
        ),
      },
    };
  });
  const calendar = [...segments].reverse().find((segment) => segment.trigger.kind === 'calendar');
  const today = scheduleCivilToday(
    calendar?.trigger.kind === 'calendar' ? calendar.trigger.schedule.timezone : 'UTC',
  );
  const [expected] = await database
    .select({ date: processOccurrence.scheduledFor })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesId, seriesId),
        gte(processOccurrence.scheduledFor, today),
        inArray(processOccurrence.status, ['expected', 'materialized']),
      ),
    )
    .orderBy(asc(processOccurrence.scheduledFor), asc(processOccurrence.id))
    .limit(1);
  return expected?.date ?? nextCalendarScheduleDate(segments);
}
