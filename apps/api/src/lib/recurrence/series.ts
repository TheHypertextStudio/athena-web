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
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
  type Database,
} from '@docket/db';
import {
  OccurrenceOut,
  RecurrenceSeriesCreate,
  RecurrenceSeriesDetailOut,
  GeneratedWorkRecurrenceOut,
  RecurrenceSeriesLifecycle,
  RecurrenceSeriesOut,
  RecurrenceSeriesRevisionOut,
  type ProcessTrigger as ProcessTriggerValue,
  type RecurrenceSeriesCreate as RecurrenceSeriesCreateValue,
  type RecurrenceSeriesLifecycle as RecurrenceSeriesLifecycleValue,
} from '../../contracts/recurrence';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../error';
import { materializeOccurrence, type MaterializedOccurrence } from './materialize';
import { triggerFromStorage, triggerStorage, utcCalendarDate } from './series-trigger';

export { triggerFromStorage, utcCalendarDate } from './series-trigger';

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

/** Load the latest published process revision available to future series occurrences. */
export async function latestProcessRevision(
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
export async function persistSeriesRevision(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
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

/** Command for creating a series over a process's latest published revision. */
export interface CreateRecurrenceSeriesCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the series and first trigger revision. */
  readonly actorId?: string | undefined;
  /** Validated series body. */
  readonly series: RecurrenceSeriesCreateValue;
}

/** Command for materializing one explicit occurrence through the public API. */
export interface MaterializeSeriesCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with generated work. */
  readonly actorId?: string | undefined;
  /** Series to execute. */
  readonly seriesId: string;
  /** Civil date to execute. */
  readonly scheduledFor: string;
  /** Optional stable key allowing distinct, retry-safe manual/event occurrences on one date. */
  readonly occurrenceKey?: string | undefined;
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
