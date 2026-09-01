/**
 * `@docket/api` — shared recurrence-series authoring behavior.
 *
 * @remarks
 * HTTP routes and Athena tools both call this module so calendar-window and completion-anchor
 * interpretation stays inside Docket's deterministic engine rather than being reimplemented by
 * each client.
 */
import type { Database } from '@docket/db';
import {
  RecurrenceSeriesCreate,
  type RecurrenceSeriesCreate as RecurrenceSeriesCreateValue,
  RecurrenceSeriesDetailOut,
} from '../../contracts/recurrence';

import { compareCalendarDates } from '@docket/planning/calendar-date';
import {
  createRecurrenceSeries,
  loadRecurrenceSeriesDetail,
  materializeSeriesOccurrence,
  utcCalendarDate,
} from './series';
import { materializeRecurrenceSeriesWindow } from './sweep';

/** Command for authoring a series and materializing its initial planning window. */
export interface CreateScheduledProcessCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the series and initially generated work. */
  readonly actorId?: string | undefined;
  /** Validated process definition, trigger, and optional effective date. */
  readonly series: RecurrenceSeriesCreateValue;
  /** Injectable clock for deterministic route and tool tests. */
  readonly now?: Date | undefined;
}

/**
 * Create a recurrence series and materialize the initial work implied by its trigger.
 *
 * @param database - Docket database handle.
 * @param command - Workspace, actor, series definition, and optional clock.
 * @returns the created series with its durable occurrence history.
 */
export async function createScheduledProcess(
  database: Database,
  command: CreateScheduledProcessCommand,
): Promise<RecurrenceSeriesDetailOut> {
  const body = RecurrenceSeriesCreate.parse(command.series);
  const series = await createRecurrenceSeries(database, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    series: body,
  });
  const today = utcCalendarDate(command.now);
  if (body.trigger.kind === 'calendar') {
    await materializeRecurrenceSeriesWindow(database, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      seriesId: series.id,
      asOf:
        compareCalendarDates(body.trigger.schedule.startDate, today) > 0
          ? body.trigger.schedule.startDate
          : today,
      now: command.now,
    });
  } else if (body.trigger.kind === 'after_completion') {
    await materializeSeriesOccurrence(database, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      seriesId: series.id,
      scheduledFor: body.effectiveFrom ?? today,
    });
  }
  return RecurrenceSeriesDetailOut.parse(
    await loadRecurrenceSeriesDetail(database, command.organizationId, series.id),
  );
}
