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
import { requireScheduleAccess } from './schedule-access';
import { requireLegacyActor } from './legacy-definition-access';

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
  return materializeScheduledProcess(database, command, series.id);
}

/**
 * Resume the initial materialization for a durably created series.
 * @param database - Docket database handle.
 * @param command - Original authoring input and the original creation clock.
 * @param seriesId - The existing series whose work must be ensured.
 * @returns The series with its current occurrence history.
 */
export async function materializeScheduledProcess(
  database: Database,
  command: CreateScheduledProcessCommand,
  seriesId: string,
): Promise<RecurrenceSeriesDetailOut> {
  const body = RecurrenceSeriesCreate.parse(command.series);
  await requireScheduleAccess(
    database,
    {
      organizationId: command.organizationId,
      actorId: requireLegacyActor(command.actorId),
      seriesId,
    },
    'manage',
  );
  const today = utcCalendarDate(command.now);
  if (body.trigger.kind === 'calendar') {
    await materializeRecurrenceSeriesWindow(database, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      seriesId,
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
      seriesId,
      scheduledFor: body.effectiveFrom ?? today,
    });
  }
  return RecurrenceSeriesDetailOut.parse(
    await loadRecurrenceSeriesDetail(database, command.organizationId, seriesId, command.actorId),
  );
}
