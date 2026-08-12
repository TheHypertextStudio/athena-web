/**
 * `@docket/api` — normalized recurrence-series authoring, lifecycle, and serialization.
 *
 * @remarks
 * Process revisions and trigger revisions remain immutable. Series lifecycle columns decide whether
 * new work may appear; occurrence exceptions record one-off decisions without rewriting cadence.
 */
import {
  processDefinition,
  processInstance,
  processInstanceProject,
  processInstanceTask,
  processOccurrence,
  processRevision,
  recurrenceException,
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
  project,
  task,
  type Database,
} from '@docket/db';
import {
  OccurrenceOut,
  ProcessTrigger,
  RecurrenceSeriesCreate,
  RecurrenceSeriesDetailOut,
  GeneratedWorkRecurrenceOut,
  RecurrenceSeriesLifecycle,
  RecurrenceSeriesOut,
  RecurrenceSeriesRevisionOut,
  SeriesEdit,
  type CalendarRecurrenceSchedule as CalendarRecurrenceScheduleValue,
  type ProcessTrigger as ProcessTriggerValue,
  type RecurrenceSeriesCreate as RecurrenceSeriesCreateValue,
  type RecurrenceSeriesLifecycle as RecurrenceSeriesLifecycleValue,
  type SeriesEdit as SeriesEditValue,
} from '@docket/types';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../error';
import { compareCalendarDates } from './calendar-date';
import { materializeOccurrence, type MaterializedOccurrence } from './materialize';

/** Database transaction surface shared by atomic recurrence authoring operations. */
export type RecurrenceTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Transaction = RecurrenceTransaction;
type SeriesRow = typeof recurrenceSeries.$inferSelect;
type SeriesRevisionRow = typeof recurrenceSeriesRevision.$inferSelect;

/** Lookup for recurrence provenance of one generated task. */
export interface GeneratedTaskLookup {
  readonly kind: 'task';
  readonly organizationId: string;
  readonly taskId: string;
}

/** Lookup for recurrence provenance of one generated project. */
export interface GeneratedProjectLookup {
  readonly kind: 'project';
  readonly organizationId: string;
  readonly projectId: string;
}

/** Any ordinary generated entity that may link back to its recurrence series. */
export type GeneratedWorkLookup = GeneratedTaskLookup | GeneratedProjectLookup;

const WEEKDAY_NUMBER = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
} as const;
const NUMBER_WEEKDAY = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
} as const;

/** Fields and selected weekdays persisted for one trigger revision. */
interface TriggerStorage {
  readonly values: Omit<
    typeof recurrenceSeriesRevision.$inferInsert,
    | 'id'
    | 'organizationId'
    | 'seriesId'
    | 'processRevisionId'
    | 'number'
    | 'effectiveFrom'
    | 'createdBy'
  >;
  readonly weekdays: readonly number[];
}

/** Command for creating a series over a process's latest published revision. */
export interface CreateRecurrenceSeriesCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the series and first trigger revision. */
  readonly actorId?: string;
  /** Validated series body. */
  readonly series: RecurrenceSeriesCreateValue;
}

/** Command for materializing one explicit occurrence through the public API. */
export interface MaterializeSeriesCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with generated work. */
  readonly actorId?: string;
  /** Series to execute. */
  readonly seriesId: string;
  /** Civil date to execute. */
  readonly scheduledFor: string;
  /** Optional stable key allowing distinct, retry-safe manual/event occurrences on one date. */
  readonly occurrenceKey?: string;
}

/** Convert a clock instant to a stable UTC civil date for non-calendar trigger defaults. */
export function utcCalendarDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Normalize a trigger union into relational columns and selected weekday rows. */
function triggerStorage(trigger: ProcessTriggerValue): TriggerStorage {
  const parsed = ProcessTrigger.parse(trigger);
  if (parsed.kind === 'manual') return { values: { triggerKind: 'manual' }, weekdays: [] };
  if (parsed.kind === 'after_completion') {
    return {
      values: {
        triggerKind: 'after_completion',
        interval: parsed.interval,
        intervalUnit: parsed.unit,
      },
      weekdays: [],
    };
  }
  if (parsed.kind === 'event') {
    return {
      values: {
        triggerKind: 'event',
        eventKind: parsed.event.kind,
        eventSubjectType: parsed.event.subjectType,
        eventSource: parsed.event.source,
        eventEntityKind: parsed.event.entityKind,
      },
      weekdays: [],
    };
  }

  const schedule = parsed.schedule;
  const endValues =
    schedule.end.kind === 'never'
      ? { endKind: 'never' as const }
      : schedule.end.kind === 'on_date'
        ? { endKind: 'on_date' as const, endDate: schedule.end.date }
        : { endKind: 'after_count' as const, endCount: schedule.end.count };
  const common = {
    triggerKind: 'calendar' as const,
    scheduleKind: schedule.kind,
    interval: schedule.interval,
    startDate: schedule.startDate,
    timezone: schedule.timezone,
    ...endValues,
    missedPolicy: parsed.missedPolicy,
    horizonDays: parsed.materialization.horizonDays,
    minimumOccurrences: parsed.materialization.minimumOccurrences,
  };
  if (schedule.kind === 'daily') return { values: common, weekdays: [] };
  if (schedule.kind === 'weekly') {
    return {
      values: common,
      weekdays: schedule.weekdays.map((weekday) => WEEKDAY_NUMBER[weekday]),
    };
  }
  if (schedule.kind === 'monthly') {
    return schedule.pattern.kind === 'day_of_month'
      ? {
          values: {
            ...common,
            monthlyPatternKind: 'day_of_month',
            monthDay: schedule.pattern.day,
            overflow: schedule.pattern.overflow,
          },
          weekdays: [],
        }
      : {
          values: {
            ...common,
            monthlyPatternKind: 'nth_weekday',
            nthWeekdayOrdinal: schedule.pattern.ordinal,
            nthWeekday: WEEKDAY_NUMBER[schedule.pattern.weekday],
          },
          weekdays: [],
        };
  }
  return {
    values: {
      ...common,
      yearMonth: schedule.month,
      yearDay: schedule.day,
      overflow: schedule.overflow,
    },
    weekdays: [],
  };
}

/** Reconstruct a canonical trigger union from one normalized revision. */
export function triggerFromStorage(
  row: SeriesRevisionRow,
  weekdayNumbers: readonly number[],
): ProcessTriggerValue {
  if (row.triggerKind === 'manual') return { kind: 'manual' };
  if (row.triggerKind === 'after_completion') {
    if (row.interval === null || row.intervalUnit === null) {
      throw new ConflictError('Completion trigger is incomplete');
    }
    return { kind: 'after_completion', interval: row.interval, unit: row.intervalUnit };
  }
  if (row.triggerKind === 'event') {
    return ProcessTrigger.parse({
      kind: 'event',
      event: {
        ...(row.eventKind === null ? {} : { kind: row.eventKind }),
        ...(row.eventSubjectType === null ? {} : { subjectType: row.eventSubjectType }),
        ...(row.eventSource === null ? {} : { source: row.eventSource }),
        ...(row.eventEntityKind === null ? {} : { entityKind: row.eventEntityKind }),
      },
    });
  }
  if (
    row.scheduleKind === null ||
    row.interval === null ||
    row.startDate === null ||
    row.timezone === null ||
    row.endKind === null ||
    row.missedPolicy === null ||
    row.horizonDays === null ||
    row.minimumOccurrences === null
  ) {
    throw new ConflictError('Calendar trigger is incomplete');
  }
  const end =
    row.endKind === 'never'
      ? { kind: 'never' as const }
      : row.endKind === 'on_date' && row.endDate !== null
        ? { kind: 'on_date' as const, date: row.endDate }
        : row.endKind === 'after_count' && row.endCount !== null
          ? { kind: 'after_count' as const, count: row.endCount }
          : null;
  if (!end) throw new ConflictError('Calendar recurrence end is incomplete');
  const common = {
    interval: row.interval,
    startDate: row.startDate,
    timezone: row.timezone,
    end,
  };
  let schedule: CalendarRecurrenceScheduleValue;
  if (row.scheduleKind === 'daily') schedule = { kind: 'daily', ...common };
  else if (row.scheduleKind === 'weekly') {
    const weekdays = weekdayNumbers.map(
      (number) => NUMBER_WEEKDAY[number as keyof typeof NUMBER_WEEKDAY],
    );
    schedule = { kind: 'weekly', ...common, weekdays };
  } else if (row.scheduleKind === 'monthly') {
    if (
      row.monthlyPatternKind === 'day_of_month' &&
      row.monthDay !== null &&
      row.overflow !== null
    ) {
      schedule = {
        kind: 'monthly',
        ...common,
        pattern: { kind: 'day_of_month', day: row.monthDay, overflow: row.overflow },
      };
    } else if (
      row.monthlyPatternKind === 'nth_weekday' &&
      row.nthWeekdayOrdinal !== null &&
      row.nthWeekday !== null
    ) {
      const weekday = NUMBER_WEEKDAY[row.nthWeekday as keyof typeof NUMBER_WEEKDAY];
      schedule = {
        kind: 'monthly',
        ...common,
        pattern: {
          kind: 'nth_weekday',
          ordinal: row.nthWeekdayOrdinal as 1 | 2 | 3 | 4 | 5 | -1,
          weekday,
        },
      };
    } else throw new ConflictError('Monthly trigger is incomplete');
  } else {
    if (row.yearMonth === null || row.yearDay === null || row.overflow === null) {
      throw new ConflictError('Yearly trigger is incomplete');
    }
    schedule = {
      kind: 'yearly',
      ...common,
      month: row.yearMonth,
      day: row.yearDay,
      overflow: row.overflow,
    };
  }
  return ProcessTrigger.parse({
    kind: 'calendar',
    schedule,
    missedPolicy: row.missedPolicy,
    materialization: {
      horizonDays: row.horizonDays,
      minimumOccurrences: row.minimumOccurrences,
    },
  });
}

/** Load the latest published process revision available to future series occurrences. */
async function latestProcessRevision(
  tx: Transaction,
  organizationId: string,
  definitionId: string,
): Promise<typeof processRevision.$inferSelect> {
  const rows = await tx
    .select({ revision: processRevision })
    .from(processRevision)
    .innerJoin(processDefinition, eq(processDefinition.id, processRevision.definitionId))
    .where(
      and(
        eq(processRevision.definitionId, definitionId),
        eq(processRevision.organizationId, organizationId),
        eq(processDefinition.status, 'published'),
        isNull(processDefinition.archivedAt),
      ),
    )
    .orderBy(desc(processRevision.number))
    .limit(1);
  const revision = rows[0]?.revision;
  if (!revision) throw new NotFoundError('Published process definition not found');
  return revision;
}

/** Persist one immutable trigger revision and its normalized weekdays. */
async function persistSeriesRevision(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly actorId?: string;
    readonly seriesId: string;
    readonly processRevisionId: string;
    readonly number: number;
    readonly effectiveFrom: string;
    readonly trigger: ProcessTriggerValue;
  },
): Promise<SeriesRevisionRow> {
  const storage = triggerStorage(input.trigger);
  const rows = await tx
    .insert(recurrenceSeriesRevision)
    .values({
      organizationId: input.organizationId,
      seriesId: input.seriesId,
      processRevisionId: input.processRevisionId,
      number: input.number,
      effectiveFrom: input.effectiveFrom,
      ...storage.values,
      createdBy: input.actorId,
    })
    .returning();
  const revision = rows[0];
  if (!revision) throw new ConflictError('Series revision could not be created');
  if (storage.weekdays.length > 0) {
    await tx
      .insert(recurrenceSeriesWeekday)
      .values(storage.weekdays.map((weekday) => ({ seriesRevisionId: revision.id, weekday })));
  }
  return revision;
}

/** Resolve the effective date default appropriate to the trigger kind. */
function effectiveDate(body: RecurrenceSeriesCreateValue): string {
  if (body.effectiveFrom) return body.effectiveFrom;
  return body.trigger.kind === 'calendar' ? body.trigger.schedule.startDate : utcCalendarDate();
}

/** Create a recurrence series over the process revision current at authoring time. */
export async function createRecurrenceSeries(
  database: Database,
  command: CreateRecurrenceSeriesCommand,
): Promise<z.input<typeof RecurrenceSeriesOut>> {
  const seriesId = await database.transaction((tx) =>
    createRecurrenceSeriesInTransaction(tx, command),
  );
  return loadRecurrenceSeries(database, command.organizationId, seriesId);
}

/**
 * Create a series and its first immutable trigger revision inside a caller-owned transaction.
 *
 * @remarks
 * Calendar bindings use this seam so the recurrence series and its stable provider binding are
 * committed together. Ordinary route authoring goes through {@link createRecurrenceSeries}.
 */
export async function createRecurrenceSeriesInTransaction(
  tx: RecurrenceTransaction,
  command: CreateRecurrenceSeriesCommand,
): Promise<string> {
  const body = RecurrenceSeriesCreate.parse(command.series);
  const revision = await latestProcessRevision(
    tx,
    command.organizationId,
    body.processDefinitionId,
  );
  const inserted = await tx
    .insert(recurrenceSeries)
    .values({
      organizationId: command.organizationId,
      definitionId: body.processDefinitionId,
      name: body.name,
      createdBy: command.actorId,
    })
    .returning({ id: recurrenceSeries.id });
  const created = inserted[0];
  if (!created) throw new ConflictError('Recurrence series could not be created');
  await persistSeriesRevision(tx, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    seriesId: created.id,
    processRevisionId: revision.id,
    number: 1,
    effectiveFrom: effectiveDate(body),
    trigger: body.trigger,
  });
  return created.id;
}

/** Load the latest authored trigger revision for one org-scoped series. */
async function loadSeriesRecord(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<{
  readonly series: SeriesRow;
  readonly revision: SeriesRevisionRow;
  readonly weekdays: number[];
}> {
  const seriesRows = await database
    .select()
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, seriesId),
        eq(recurrenceSeries.organizationId, organizationId),
        isNull(recurrenceSeries.archivedAt),
      ),
    )
    .limit(1);
  const series = seriesRows[0];
  if (!series) throw new NotFoundError('Recurrence series not found');
  const revisions = await database
    .select()
    .from(recurrenceSeriesRevision)
    .where(eq(recurrenceSeriesRevision.seriesId, seriesId))
    .orderBy(desc(recurrenceSeriesRevision.number))
    .limit(1);
  const revision = revisions[0];
  if (!revision) throw new ConflictError('Recurrence series has no trigger revision');
  const weekdays = (
    await database
      .select({ weekday: recurrenceSeriesWeekday.weekday })
      .from(recurrenceSeriesWeekday)
      .where(eq(recurrenceSeriesWeekday.seriesRevisionId, revision.id))
      .orderBy(recurrenceSeriesWeekday.weekday)
  ).map((value) => value.weekday);
  return { series, revision, weekdays };
}

/** Serialize one org-scoped recurrence series with its latest authored trigger. */
export async function loadRecurrenceSeries(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<z.input<typeof RecurrenceSeriesOut>> {
  const { series, revision, weekdays } = await loadSeriesRecord(database, organizationId, seriesId);
  return RecurrenceSeriesOut.parse({
    id: series.id,
    organizationId: series.organizationId,
    processDefinitionId: series.definitionId,
    processRevisionId: revision.processRevisionId,
    name: series.name,
    status: series.status,
    trigger: triggerFromStorage(revision, weekdays),
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
    pausedAt: series.pausedAt?.toISOString() ?? null,
    endedAt: series.endedAt?.toISOString() ?? null,
  });
}

/** List org-scoped recurrence series with each latest authored trigger. */
export async function listRecurrenceSeries(
  database: Database,
  organizationId: string,
): Promise<z.input<typeof RecurrenceSeriesOut>[]> {
  const rows = await database
    .select({ id: recurrenceSeries.id })
    .from(recurrenceSeries)
    .where(
      and(eq(recurrenceSeries.organizationId, organizationId), isNull(recurrenceSeries.archivedAt)),
    )
    .orderBy(desc(recurrenceSeries.updatedAt));
  return Promise.all(rows.map((row) => loadRecurrenceSeries(database, organizationId, row.id)));
}

/** Serialize one durable occurrence and its first generated task when present. */
async function occurrenceOutputs(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<z.input<typeof OccurrenceOut>[]> {
  const rows = await database
    .select({ occurrence: processOccurrence, instanceId: processInstance.id })
    .from(processOccurrence)
    .leftJoin(processInstance, eq(processInstance.occurrenceId, processOccurrence.id))
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesId, seriesId),
      ),
    )
    .orderBy(processOccurrence.scheduledFor);
  const instanceIds = rows.flatMap((row) => (row.instanceId ? [row.instanceId] : []));
  const taskRows =
    instanceIds.length === 0
      ? []
      : await database
          .select({
            instanceId: processInstanceTask.instanceId,
            taskId: processInstanceTask.taskId,
          })
          .from(processInstanceTask)
          .where(inArray(processInstanceTask.instanceId, instanceIds));
  const firstTaskByInstance = new Map<string, string>();
  for (const row of taskRows) {
    if (!firstTaskByInstance.has(row.instanceId))
      firstTaskByInstance.set(row.instanceId, row.taskId);
  }
  return rows.map((row) =>
    OccurrenceOut.parse({
      id: row.occurrence.id,
      seriesId: row.occurrence.seriesId,
      scheduledFor: row.occurrence.scheduledFor,
      originalScheduledFor: row.occurrence.originalScheduledFor,
      status: row.occurrence.status,
      processInstanceId: row.instanceId,
      taskId: row.instanceId ? (firstTaskByInstance.get(row.instanceId) ?? null) : null,
      resolvedAt: row.occurrence.resolvedAt?.toISOString() ?? null,
    }),
  );
}

/** Serialize every immutable trigger revision for one org-scoped recurrence series. */
async function seriesRevisionOutputs(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<z.input<typeof RecurrenceSeriesRevisionOut>[]> {
  const revisions = await database
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.organizationId, organizationId),
        eq(recurrenceSeriesRevision.seriesId, seriesId),
      ),
    )
    .orderBy(recurrenceSeriesRevision.number);
  const revisionIds = revisions.map((revision) => revision.id);
  const weekdays =
    revisionIds.length === 0
      ? []
      : await database
          .select()
          .from(recurrenceSeriesWeekday)
          .where(inArray(recurrenceSeriesWeekday.seriesRevisionId, revisionIds));
  const weekdaysByRevision = new Map<string, number[]>();
  for (const value of weekdays) {
    const current = weekdaysByRevision.get(value.seriesRevisionId) ?? [];
    current.push(value.weekday);
    weekdaysByRevision.set(value.seriesRevisionId, current);
  }
  return revisions.map((revision) =>
    RecurrenceSeriesRevisionOut.parse({
      id: revision.id,
      seriesId: revision.seriesId,
      processRevisionId: revision.processRevisionId,
      number: revision.number,
      effectiveFrom: revision.effectiveFrom,
      trigger: triggerFromStorage(
        revision,
        (weekdaysByRevision.get(revision.id) ?? []).sort((a, b) => a - b),
      ),
      createdAt: revision.createdAt.toISOString(),
    }),
  );
}

/** Load a series and its complete occurrence history/planning window. */
export async function loadRecurrenceSeriesDetail(
  database: Database,
  organizationId: string,
  seriesId: string,
): Promise<z.input<typeof RecurrenceSeriesDetailOut>> {
  const [series, revisions, occurrences] = await Promise.all([
    loadRecurrenceSeries(database, organizationId, seriesId),
    seriesRevisionOutputs(database, organizationId, seriesId),
    occurrenceOutputs(database, organizationId, seriesId),
  ]);
  return RecurrenceSeriesDetailOut.parse({ ...series, revisions, occurrences });
}

/** Apply a validated, idempotent lifecycle transition to a series. */
export async function transitionRecurrenceSeries(
  database: Database,
  organizationId: string,
  seriesId: string,
  command: RecurrenceSeriesLifecycleValue,
): Promise<z.input<typeof RecurrenceSeriesOut>> {
  const transition = RecurrenceSeriesLifecycle.parse(command);
  const current = await loadSeriesRecord(database, organizationId, seriesId);
  if (current.series.status === 'ended' && transition.action !== 'end') {
    throw new ConflictError('Ended recurrence series cannot resume or pause');
  }
  const now = new Date();
  await database
    .update(recurrenceSeries)
    .set(
      transition.action === 'pause'
        ? { status: 'paused', pausedAt: current.series.pausedAt ?? now }
        : transition.action === 'resume'
          ? { status: 'active', pausedAt: null }
          : { status: 'ended', endedAt: current.series.endedAt ?? now },
    )
    .where(
      and(eq(recurrenceSeries.id, seriesId), eq(recurrenceSeries.organizationId, organizationId)),
    );
  return loadRecurrenceSeries(database, organizationId, seriesId);
}

/** Select the trigger revision governing one calendar date. */
export async function seriesRevisionAt(
  database: Database,
  organizationId: string,
  seriesId: string,
  scheduledFor: string,
): Promise<SeriesRevisionRow> {
  const rows = await database
    .select({ revision: recurrenceSeriesRevision })
    .from(recurrenceSeriesRevision)
    .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, recurrenceSeriesRevision.seriesId))
    .where(
      and(
        eq(recurrenceSeriesRevision.seriesId, seriesId),
        eq(recurrenceSeries.organizationId, organizationId),
        lte(recurrenceSeriesRevision.effectiveFrom, scheduledFor),
      ),
    )
    .orderBy(desc(recurrenceSeriesRevision.effectiveFrom), desc(recurrenceSeriesRevision.number))
    .limit(1);
  const revision = rows[0]?.revision;
  if (!revision) throw new NotFoundError('Recurrence series revision not found for this date');
  return revision;
}

/** Materialize one explicit occurrence using the trigger revision governing its date. */
export async function materializeSeriesOccurrence(
  database: Database,
  command: MaterializeSeriesCommand,
): Promise<MaterializedOccurrence> {
  const current = await loadSeriesRecord(database, command.organizationId, command.seriesId);
  if (current.series.status !== 'active') {
    throw new ConflictError('Only an active recurrence series can create work');
  }
  const revision = await seriesRevisionAt(
    database,
    command.organizationId,
    command.seriesId,
    command.scheduledFor,
  );
  return materializeOccurrence(database, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    seriesId: command.seriesId,
    seriesRevisionId: revision.id,
    scheduledFor: command.scheduledFor,
    externalOccurrenceKey: command.occurrenceKey,
  });
}

/** Load the recurrence-series backlink for one ordinary generated task or project. */
export async function loadGeneratedWorkRecurrence(
  database: Database,
  lookup: GeneratedWorkLookup,
): Promise<z.input<typeof GeneratedWorkRecurrenceOut> | null> {
  const selected = {
    seriesId: recurrenceSeries.id,
    seriesName: recurrenceSeries.name,
    seriesStatus: recurrenceSeries.status,
    processDefinitionId: processInstance.definitionId,
    processInstanceId: processInstance.id,
    occurrenceId: processOccurrence.id,
    scheduledFor: processOccurrence.scheduledFor,
    occurrenceStatus: processOccurrence.status,
  };
  if (lookup.kind === 'task') {
    const rows = await database
      .select(selected)
      .from(processInstanceTask)
      .innerJoin(processInstance, eq(processInstance.id, processInstanceTask.instanceId))
      .innerJoin(processOccurrence, eq(processOccurrence.id, processInstance.occurrenceId))
      .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, processOccurrence.seriesId))
      .where(
        and(
          eq(processInstanceTask.taskId, lookup.taskId),
          eq(processInstanceTask.organizationId, lookup.organizationId),
        ),
      )
      .limit(1);
    return rows[0]
      ? GeneratedWorkRecurrenceOut.parse({ kind: 'task', taskId: lookup.taskId, ...rows[0] })
      : null;
  }
  const rows = await database
    .select(selected)
    .from(processInstanceProject)
    .innerJoin(processInstance, eq(processInstance.id, processInstanceProject.instanceId))
    .innerJoin(processOccurrence, eq(processOccurrence.id, processInstance.occurrenceId))
    .innerJoin(recurrenceSeries, eq(recurrenceSeries.id, processOccurrence.seriesId))
    .where(
      and(
        eq(processInstanceProject.projectId, lookup.projectId),
        eq(processInstanceProject.organizationId, lookup.organizationId),
      ),
    )
    .limit(1);
  return rows[0]
    ? GeneratedWorkRecurrenceOut.parse({ kind: 'project', projectId: lookup.projectId, ...rows[0] })
    : null;
}

/** Append a future trigger revision without changing any prior occurrence or instance. */
async function appendFutureSeriesRevision(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string;
    readonly seriesId: string;
    readonly effectiveFrom: string;
    /** Civil date used to enforce future-only revision boundaries. */
    readonly asOf?: string;
    readonly trigger: ProcessTriggerValue;
    readonly onRetired?: (work: RetiredFutureWork) => Promise<void>;
  },
): Promise<void> {
  const retired = await database.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.id, input.seriesId),
          eq(recurrenceSeries.organizationId, input.organizationId),
        ),
      )
      .for('update')
      .limit(1);
    const series = rows[0];
    if (!series) throw new NotFoundError('Recurrence series not found');
    if (series.status === 'ended') throw new ConflictError('Ended recurrence series cannot change');
    const latest = await tx
      .select({
        number: recurrenceSeriesRevision.number,
        effectiveFrom: recurrenceSeriesRevision.effectiveFrom,
      })
      .from(recurrenceSeriesRevision)
      .where(eq(recurrenceSeriesRevision.seriesId, input.seriesId))
      .orderBy(desc(recurrenceSeriesRevision.number))
      .limit(1);
    const asOf = input.asOf ?? utcCalendarDate();
    if (compareCalendarDates(input.effectiveFrom, asOf) < 0) {
      throw new ConflictError('Future schedule changes cannot begin in the past');
    }
    if (
      latest[0] &&
      compareCalendarDates(input.effectiveFrom, latest[0].effectiveFrom) <= 0
    ) {
      throw new ConflictError('Future schedule changes must follow the latest schedule version');
    }
    const process = await latestProcessRevision(tx, input.organizationId, series.definitionId);
    await persistSeriesRevision(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      processRevisionId: process.id,
      number: (latest[0]?.number ?? 0) + 1,
      effectiveFrom: input.effectiveFrom,
      trigger: input.trigger,
    });
    return retireUnfinishedFutureOccurrences(tx, {
      organizationId: input.organizationId,
      seriesId: input.seriesId,
      effectiveFrom: input.effectiveFrom,
    });
  });
  await input.onRetired?.(retired);
}

/** Retired generated entities from superseded unfinished future occurrences. */
interface RetiredFutureWork {
  readonly taskIds: string[];
  readonly projectIds: string[];
}

/** One occurrence and its optional generated instance selected for retirement. */
interface OccurrenceRetirementCandidate {
  readonly occurrenceId: string;
  readonly instanceId: string | null;
}

/** Internal retirement result including occurrences protected by completed work. */
interface OccurrenceRetirementResult extends RetiredFutureWork {
  readonly completedOccurrenceIds: string[];
}

/** Archive generated work and cancel instances without deciding the occurrence's final outcome. */
async function retireGeneratedOccurrenceWork(
  tx: Transaction,
  candidates: readonly OccurrenceRetirementCandidate[],
  now: Date,
): Promise<OccurrenceRetirementResult> {
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  const completedOccurrenceIds: string[] = [];
  for (const candidate of candidates) {
    const mappedTasks = candidate.instanceId
      ? await tx
          .select({ id: task.id, completedAt: task.completedAt })
          .from(processInstanceTask)
          .innerJoin(task, eq(task.id, processInstanceTask.taskId))
          .where(eq(processInstanceTask.instanceId, candidate.instanceId))
      : [];
    if (mappedTasks.some((row) => row.completedAt !== null)) {
      completedOccurrenceIds.push(candidate.occurrenceId);
      continue;
    }
    const mappedProjects = candidate.instanceId
      ? await tx
          .select({ id: project.id })
          .from(processInstanceProject)
          .innerJoin(project, eq(project.id, processInstanceProject.projectId))
          .where(eq(processInstanceProject.instanceId, candidate.instanceId))
      : [];
    if (mappedTasks.length > 0) {
      const ids = mappedTasks.map((row) => row.id);
      await tx.update(task).set({ archivedAt: now }).where(inArray(task.id, ids));
      taskIds.push(...ids);
    }
    if (mappedProjects.length > 0) {
      const ids = mappedProjects.map((row) => row.id);
      await tx.update(project).set({ archivedAt: now }).where(inArray(project.id, ids));
      projectIds.push(...ids);
    }
    if (candidate.instanceId) {
      await tx
        .update(processInstance)
        .set({ status: 'canceled' })
        .where(eq(processInstance.id, candidate.instanceId));
    }
  }
  return { taskIds, projectIds, completedOccurrenceIds };
}

/**
 * Retire only unfinished materialized work at and after a future revision boundary.
 *
 * @remarks
 * A rolling horizon means future occurrences already have ordinary rows. Saving a new cadence must
 * not leave those stale rows visible. Completed-early work is preserved and blocks replacement for
 * its date; every other generated task/project is soft-archived and its old instance is canceled.
 */
async function retireUnfinishedFutureOccurrences(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly seriesId: string;
    readonly effectiveFrom: string;
  },
): Promise<RetiredFutureWork> {
  const candidates = await tx
    .select({ occurrenceId: processOccurrence.id, instanceId: processInstance.id })
    .from(processOccurrence)
    .leftJoin(processInstance, eq(processInstance.occurrenceId, processOccurrence.id))
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        gte(processOccurrence.scheduledFor, input.effectiveFrom),
        inArray(processOccurrence.status, ['expected', 'materialized', 'needs_resolution']),
      ),
    );
  const now = new Date();
  const retired = await retireGeneratedOccurrenceWork(tx, candidates, now);
  const supersededIds = candidates
    .map((candidate) => candidate.occurrenceId)
    .filter((id) => !retired.completedOccurrenceIds.includes(id));
  if (supersededIds.length > 0) {
    await tx
      .update(processOccurrence)
      .set({ status: 'superseded', resolvedAt: now })
      .where(inArray(processOccurrence.id, supersededIds));
  }
  return { taskIds: retired.taskIds, projectIds: retired.projectIds };
}

/** Apply a one-occurrence resolution or a this-and-future trigger edit. */
export async function editRecurrenceSeries(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string;
    readonly seriesId: string;
    /** Civil date used to enforce future-only revision boundaries. */
    readonly asOf?: string;
    readonly edit: SeriesEditValue;
    readonly onRetired?: (work: RetiredFutureWork) => Promise<void>;
  },
): Promise<z.input<typeof RecurrenceSeriesDetailOut>> {
  const edit = SeriesEdit.parse(input.edit);
  if (edit.scope === 'future') {
    await appendFutureSeriesRevision(database, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      effectiveFrom: edit.effectiveFrom,
      asOf: input.asOf,
      trigger: edit.trigger,
      onRetired: input.onRetired,
    });
    return loadRecurrenceSeriesDetail(database, input.organizationId, input.seriesId);
  }

  const revision = await seriesRevisionAt(
    database,
    input.organizationId,
    input.seriesId,
    edit.scheduledFor,
  );
  const now = new Date();
  if (edit.resolution.kind === 'complete') {
    const updated = await database
      .update(processOccurrence)
      .set({ status: 'completed', resolvedAt: now })
      .where(
        and(
          eq(processOccurrence.organizationId, input.organizationId),
          eq(processOccurrence.seriesId, input.seriesId),
          eq(processOccurrence.scheduledFor, edit.scheduledFor),
        ),
      )
      .returning({ id: processOccurrence.id });
    if (!updated[0]) throw new NotFoundError('Occurrence not found');
  } else {
    const kind = edit.resolution.kind === 'reschedule' ? 'reschedule' : 'exclude';
    const retired = await database.transaction(async (tx) => {
      const candidates = await tx
        .select({ occurrenceId: processOccurrence.id, instanceId: processInstance.id })
        .from(processOccurrence)
        .leftJoin(processInstance, eq(processInstance.occurrenceId, processOccurrence.id))
        .where(
          and(
            eq(processOccurrence.organizationId, input.organizationId),
            eq(processOccurrence.seriesId, input.seriesId),
            eq(processOccurrence.scheduledFor, edit.scheduledFor),
            inArray(processOccurrence.status, ['expected', 'materialized', 'needs_resolution']),
          ),
        );
      const retirement = await retireGeneratedOccurrenceWork(tx, candidates, now);
      if (retirement.completedOccurrenceIds.length > 0) {
        throw new ConflictError('Completed occurrence work cannot be skipped or moved');
      }
      await tx
        .insert(recurrenceException)
        .values({
          organizationId: input.organizationId,
          seriesRevisionId: revision.id,
          kind,
          scheduledFor: edit.scheduledFor,
          replacementDate:
            edit.resolution.kind === 'reschedule' ? edit.resolution.scheduledFor : undefined,
          createdBy: input.actorId,
        })
        .onConflictDoUpdate({
          target: [recurrenceException.seriesRevisionId, recurrenceException.scheduledFor],
          set: {
            kind,
            replacementDate:
              edit.resolution.kind === 'reschedule' ? edit.resolution.scheduledFor : null,
          },
        });
      await tx
        .insert(processOccurrence)
        .values({
          organizationId: input.organizationId,
          seriesId: input.seriesId,
          seriesRevisionId: revision.id,
          scheduledFor: edit.scheduledFor,
          status: edit.resolution.kind === 'skip' ? 'skipped' : 'canceled',
          resolvedAt: now,
          createdBy: input.actorId,
        })
        .onConflictDoUpdate({
          target: [
            processOccurrence.seriesId,
            processOccurrence.seriesRevisionId,
            processOccurrence.scheduledFor,
          ],
          targetWhere: isNull(processOccurrence.externalOccurrenceKey),
          set: {
            status: edit.resolution.kind === 'skip' ? 'skipped' : 'canceled',
            resolvedAt: now,
          },
        });
      return { taskIds: retirement.taskIds, projectIds: retirement.projectIds };
    });
    await input.onRetired?.(retired);
    if (edit.resolution.kind === 'reschedule') {
      await materializeOccurrence(database, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        seriesId: input.seriesId,
        seriesRevisionId: revision.id,
        scheduledFor: edit.resolution.scheduledFor,
        originalScheduledFor: edit.scheduledFor,
      });
    }
  }
  return loadRecurrenceSeriesDetail(database, input.organizationId, input.seriesId);
}
