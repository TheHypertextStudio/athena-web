/**
 * `@docket/api` — one-call repeating-task authoring over the general process engine.
 *
 * @remarks
 * The ordinary task composer is preserved as a one-task immutable process revision. Calendar
 * schedules immediately materialize a rolling planning window; completion schedules create one
 * task and wait for its actual completion before advancing.
 */
import { task, type Database } from '@docket/db';
import {
  RecurringTaskCreate,
  RecurringTaskCreated,
  ProcessDefinitionId,
  type ProcessDefinitionCreate,
  type RecurringTaskCreate as RecurringTaskCreateValue,
} from '@docket/types';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError } from '../../error';
import { labelsForSubject } from '../labels';
import { toOut } from '../../routes/task-helpers';
import { calendarDaysBetween, compareCalendarDates } from './calendar-date';
import { expandCalendarSchedule, materializationWindow } from './expand';
import { createPublishedProcessDefinition } from './process-definition';
import {
  createRecurrenceSeries,
  loadRecurrenceSeriesDetail,
  materializeSeriesOccurrence,
  utcCalendarDate,
} from './series';

/** Command for creating a recurring task from the ordinary task draft. */
export interface CreateRecurringTaskCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the definition, series, and concrete tasks. */
  readonly actorId?: string;
  /** Validated ordinary task plus recurrence behavior. */
  readonly recurringTask: RecurringTaskCreateValue;
  /** Injectable clock used by tests and completion-trigger defaults. */
  readonly now?: Date;
}

/** Select the occurrence date whose task date offsets preserve the ordinary draft. */
function firstAnchor(body: RecurringTaskCreateValue, today: string): string {
  if (body.schedule.kind !== 'after_completion') return body.schedule.startDate;
  return body.task.dueDate ?? body.task.startDate ?? today;
}

/** Convert one ordinary task draft to the general one-step process model. */
function oneTaskProcess(body: RecurringTaskCreateValue, anchor: string): ProcessDefinitionCreate {
  const draft = body.task;
  return {
    name: draft.title,
    description: draft.description,
    creationMode: 'all_at_once',
    milestones: [],
    tasks: [
      {
        key: 'task',
        title: draft.title,
        description: draft.description,
        teamId: draft.teamId,
        state: draft.state,
        priority: draft.priority ?? 'none',
        assigneeId: draft.assigneeId,
        projectId: draft.projectId,
        milestoneId: draft.milestoneId,
        cycleId: draft.cycleId,
        parentTaskId: draft.parentTaskId,
        estimate: draft.estimate,
        ...(draft.estimateMinutes == null ? {} : { estimateMinutes: draft.estimateMinutes }),
        ...(draft.startDate === undefined
          ? {}
          : { startOffsetDays: calendarDaysBetween(anchor, draft.startDate) }),
        ...(draft.dueDate === undefined
          ? {}
          : { dueOffsetDays: calendarDaysBetween(anchor, draft.dueDate) }),
        labelIds: draft.labels ?? [],
        timing: { kind: 'on_trigger' },
      },
    ],
    dependencies: [],
  };
}

/** Create the shared process definition, series, and first planning window for a recurring task. */
export async function createRecurringTask(
  database: Database,
  command: CreateRecurringTaskCommand,
): Promise<z.input<typeof RecurringTaskCreated>> {
  const body = RecurringTaskCreate.parse(command.recurringTask);
  const today = utcCalendarDate(command.now);
  const anchor = firstAnchor(body, today);
  const process = await createPublishedProcessDefinition(database, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    definition: oneTaskProcess(body, anchor),
  });
  const materialization = body.materialization ?? { horizonDays: 28, minimumOccurrences: 2 };
  const trigger =
    body.schedule.kind === 'after_completion'
      ? {
          kind: 'after_completion' as const,
          interval: body.schedule.interval,
          unit: body.schedule.unit,
        }
      : {
          kind: 'calendar' as const,
          schedule: body.schedule,
          missedPolicy: body.missedPolicy ?? 'skip',
          materialization,
        };
  const series = await createRecurrenceSeries(database, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    series: {
      processDefinitionId: ProcessDefinitionId.parse(process.definitionId),
      name: body.task.title,
      trigger,
      effectiveFrom: anchor,
    },
  });
  const dates =
    body.schedule.kind === 'after_completion'
      ? [anchor]
      : (() => {
          const from =
            compareCalendarDates(body.schedule.startDate, today) > 0
              ? body.schedule.startDate
              : today;
          const window = materializationWindow(from, materialization);
          return expandCalendarSchedule(body.schedule, window);
        })();
  if (dates.length === 0) {
    throw new ConflictError('The recurrence schedule has no upcoming occurrence');
  }
  for (const scheduledFor of dates) {
    await materializeSeriesOccurrence(database, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      seriesId: series.id,
      scheduledFor,
    });
  }
  const detail = await loadRecurrenceSeriesDetail(database, command.organizationId, series.id);
  const firstOccurrence = detail.occurrences.find(
    (occurrence) => occurrence.scheduledFor === dates[0],
  );
  if (!firstOccurrence?.taskId) throw new ConflictError('Recurring task did not materialize');
  const rows = await database
    .select()
    .from(task)
    .where(eq(task.id, firstOccurrence.taskId))
    .limit(1);
  const firstTask = rows[0];
  if (!firstTask) throw new ConflictError('Materialized recurring task was not found');
  const labels = await labelsForSubject('task', command.organizationId, firstTask.id, database);
  return RecurringTaskCreated.parse({
    series,
    firstTask: toOut(firstTask, labels),
    occurrences: detail.occurrences,
  });
}
