/**
 * `@docket/api` — editing a recurrence series without rewriting what it already produced.
 *
 * @remarks
 * A series is a sequence of immutable trigger revisions, and an edit never changes one: a
 * this-and-future edit appends a new revision from a date forward, and an occurrence-scoped edit
 * records an exception against the revision that owns that date. Work already materialized from a
 * past occurrence is therefore untouched by any edit, which is what lets a person reshape a
 * recurring commitment without their finished work changing underneath them.
 *
 * What an edit *does* remove is work the series generated for dates that have not happened yet.
 * That retirement archives rather than deletes, and refuses outright when the work has already
 * been completed — a completed task is a fact about what someone did, not a scheduling artifact.
 */
import {
  processInstance,
  processInstanceProject,
  processInstanceTask,
  processOccurrence,
  project,
  recurrenceException,
  recurrenceSeries,
  recurrenceSeriesRevision,
  task,
  type Database,
} from '@docket/db';
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import {
  SeriesEdit,
  type ProcessTrigger as ProcessTriggerValue,
  type RecurrenceSeriesDetailOut,
  type SeriesEdit as SeriesEditValue,
} from '../../contracts/recurrence';
import { ConflictError, NotFoundError } from '../../error';
import { compareCalendarDates } from '@docket/planning/calendar-date';
import type { TaskStateMutation } from '../task-state';

import { materializeOccurrence } from './materialize';
import type { ProcessTransaction as RecurrenceTransaction } from './process-contracts';

type Transaction = RecurrenceTransaction;
import { utcCalendarDate } from './series-trigger';
import {
  latestProcessRevision,
  loadRecurrenceSeriesDetail,
  persistSeriesRevision,
  seriesRevisionAt,
} from './series';

/** Append a future trigger revision without changing any prior occurrence or instance. */
async function appendFutureSeriesRevision(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
    readonly seriesId: string;
    readonly effectiveFrom: string;
    /** Civil date used to enforce future-only revision boundaries. */
    readonly asOf?: string | undefined;
    readonly trigger: ProcessTriggerValue;
    readonly onRetired?: ((work: RetiredFutureWork) => Promise<void>) | undefined;
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
    if (latest[0] && compareCalendarDates(input.effectiveFrom, latest[0].effectiveFrom) <= 0) {
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
  await finishRetiredTaskCascades(retired.cascades);
  await input.onRetired?.({ taskIds: retired.taskIds, projectIds: retired.projectIds });
}

/** Retired generated entities from superseded unfinished future occurrences. */
interface RetiredFutureWork {
  readonly taskIds: string[];
  readonly projectIds: string[];
}

/** Retired work plus task-parent state transitions that commit with the retirement. */
interface RetiredFutureWorkWithCascades extends RetiredFutureWork {
  readonly cascades: TaskStateMutation[];
}

/** One occurrence and its optional generated instance selected for retirement. */
interface OccurrenceRetirementCandidate {
  readonly occurrenceId: string;
  readonly instanceId: string | null;
}

/** Internal retirement result including occurrences protected by completed work. */
interface OccurrenceRetirementResult extends RetiredFutureWorkWithCascades {
  readonly completedOccurrenceIds: string[];
}

/** Archive generated work and cancel instances without deciding the occurrence's final outcome. */
async function retireGeneratedOccurrenceWork(
  tx: Transaction,
  organizationId: string,
  candidates: readonly OccurrenceRetirementCandidate[],
  now: Date,
): Promise<OccurrenceRetirementResult> {
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  const parentTaskIds: (string | null)[] = [];
  const completedOccurrenceIds: string[] = [];
  for (const candidate of candidates) {
    const mappedTasks = candidate.instanceId
      ? await tx
          .select({ id: task.id, completedAt: task.completedAt, parentTaskId: task.parentTaskId })
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
      parentTaskIds.push(...mappedTasks.map((row) => row.parentTaskId));
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
  const { applySubtaskCompletionPolicyForParents } = await import('../task-state');
  const cascades = await applySubtaskCompletionPolicyForParents(tx, organizationId, parentTaskIds);
  return { taskIds, projectIds, completedOccurrenceIds, cascades };
}

/** Publish task-parent transitions after their recurrence retirement transaction commits. */
async function finishRetiredTaskCascades(cascades: readonly TaskStateMutation[]): Promise<void> {
  const { finishTaskStateTransition } = await import('../task-state');
  for (const cascade of cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
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
): Promise<RetiredFutureWorkWithCascades> {
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
  const retired = await retireGeneratedOccurrenceWork(tx, input.organizationId, candidates, now);
  const supersededIds = candidates
    .map((candidate) => candidate.occurrenceId)
    .filter((id) => !retired.completedOccurrenceIds.includes(id));
  if (supersededIds.length > 0) {
    await tx
      .update(processOccurrence)
      .set({ status: 'superseded', resolvedAt: now })
      .where(inArray(processOccurrence.id, supersededIds));
  }
  return { taskIds: retired.taskIds, projectIds: retired.projectIds, cascades: retired.cascades };
}

/**
 * Mark one expected occurrence complete.
 *
 * @param database - The database handle.
 * @param organizationId - The workspace that owns the series.
 * @param seriesId - The series the occurrence belongs to.
 * @param scheduledFor - The occurrence's civil date.
 * @throws {NotFoundError} When the series has no occurrence on that date.
 */
async function completeOneOccurrence(
  database: Database,
  organizationId: string,
  seriesId: string,
  scheduledFor: string,
): Promise<void> {
  const updated = await database
    .update(processOccurrence)
    .set({ status: 'completed', resolvedAt: new Date() })
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesId, seriesId),
        eq(processOccurrence.scheduledFor, scheduledFor),
      ),
    )
    .returning({ id: processOccurrence.id });
  if (!updated[0]) throw new NotFoundError('Occurrence not found');
}

/** One occurrence taken out of its series, as both an exception and a resolved occurrence. */
interface OccurrenceResolution {
  readonly organizationId: string;
  readonly actorId?: string | undefined;
  readonly seriesId: string;
  readonly revisionId: string;
  readonly scheduledFor: string;
  /** Whether the date is excluded outright or replaced by another. */
  readonly kind: 'exclude' | 'reschedule';
  /** The status the occurrence row settles on. */
  readonly status: 'skipped' | 'canceled';
  readonly replacementDate: string | undefined;
  readonly now: Date;
}

/**
 * Record one occurrence's removal against both the revision and the occurrence table.
 *
 * @remarks
 * Both writes, because they answer different questions: the exception is what future expansions
 * read, and the occurrence row is what an already-expanded calendar shows. Recording only one
 * would make the two disagree about the same date.
 *
 * @param tx - The open transaction.
 * @param resolution - The occurrence being removed.
 */
async function recordOccurrenceResolution(
  tx: RecurrenceTransaction,
  resolution: OccurrenceResolution,
): Promise<void> {
  const { organizationId, seriesId, revisionId, scheduledFor, kind, status, now } = resolution;
  await tx
    .insert(recurrenceException)
    .values({
      organizationId,
      seriesRevisionId: revisionId,
      kind,
      scheduledFor,
      replacementDate: resolution.replacementDate,
      createdBy: resolution.actorId,
    })
    .onConflictDoUpdate({
      target: [recurrenceException.seriesRevisionId, recurrenceException.scheduledFor],
      set: { kind, replacementDate: resolution.replacementDate ?? null },
    });
  await tx
    .insert(processOccurrence)
    .values({
      organizationId,
      seriesId,
      seriesRevisionId: revisionId,
      scheduledFor,
      status,
      resolvedAt: now,
      createdBy: resolution.actorId,
    })
    .onConflictDoUpdate({
      target: [
        processOccurrence.seriesId,
        processOccurrence.seriesRevisionId,
        processOccurrence.scheduledFor,
      ],
      targetWhere: isNull(processOccurrence.externalOccurrenceKey),
      set: { status, resolvedAt: now },
    });
}

/** One occurrence-scoped edit that takes an occurrence out of the series. */
interface OccurrenceEditInput {
  readonly organizationId: string;
  readonly actorId?: string | undefined;
  readonly seriesId: string;
  readonly onRetired?: ((work: RetiredFutureWork) => Promise<void>) | undefined;
}

/**
 * Skip or move one occurrence, retiring the work it already generated.
 *
 * @remarks
 * Recorded as an exception against the revision as well as a resolved occurrence row, so the
 * expansion that produces future dates agrees with the occurrences that already exist. A
 * reschedule then materializes the replacement date, carrying the original forward on the new row.
 *
 * @param database - The database handle.
 * @param input - The workspace, series, and retirement callback.
 * @param revisionId - The trigger revision the occurrence belongs to.
 * @param edit - The validated occurrence resolution.
 * @throws {ConflictError} When the occurrence's work has already been completed.
 */
async function resolveOneOccurrenceAway(
  database: Database,
  input: OccurrenceEditInput,
  revisionId: string,
  edit: Extract<SeriesEditValue, { scope: 'occurrence' }>,
): Promise<void> {
  const now = new Date();
  const kind = edit.resolution.kind === 'reschedule' ? 'reschedule' : 'exclude';
  const status = edit.resolution.kind === 'skip' ? ('skipped' as const) : ('canceled' as const);
  const replacementDate =
    edit.resolution.kind === 'reschedule' ? edit.resolution.scheduledFor : undefined;

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
    const retirement = await retireGeneratedOccurrenceWork(
      tx,
      input.organizationId,
      candidates,
      now,
    );
    if (retirement.completedOccurrenceIds.length > 0) {
      throw new ConflictError('Completed occurrence work cannot be skipped or moved');
    }
    await recordOccurrenceResolution(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      revisionId,
      scheduledFor: edit.scheduledFor,
      kind,
      status,
      replacementDate,
      now,
    });
    return {
      taskIds: retirement.taskIds,
      projectIds: retirement.projectIds,
      cascades: retirement.cascades,
    };
  });

  await finishRetiredTaskCascades(retired.cascades);
  await input.onRetired?.({ taskIds: retired.taskIds, projectIds: retired.projectIds });
  if (edit.resolution.kind === 'reschedule') {
    await materializeOccurrence(database, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: input.seriesId,
      seriesRevisionId: revisionId,
      scheduledFor: edit.resolution.scheduledFor,
      originalScheduledFor: edit.scheduledFor,
    });
  }
}

/** Apply a one-occurrence resolution or a this-and-future trigger edit. */
export async function editRecurrenceSeries(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
    readonly seriesId: string;
    /** Civil date used to enforce future-only revision boundaries. */
    readonly asOf?: string | undefined;
    readonly edit: SeriesEditValue;
    readonly onRetired?: ((work: RetiredFutureWork) => Promise<void>) | undefined;
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
  if (edit.resolution.kind === 'complete') {
    await completeOneOccurrence(database, input.organizationId, input.seriesId, edit.scheduledFor);
  } else {
    await resolveOneOccurrenceAway(database, input, revision.id, edit);
  }
  return loadRecurrenceSeriesDetail(database, input.organizationId, input.seriesId);
}
