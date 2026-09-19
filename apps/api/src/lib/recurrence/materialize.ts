/**
 * `@docket/api` — idempotent process occurrence and concrete work materialization.
 *
 * @remarks
 * Every generated Project, Milestone, and Task is an ordinary Docket row. Source mappings retain
 * the immutable revision step that created it, while unique constraints and an instance row lock
 * make scheduler retries converge on the same work instead of manufacturing duplicates.
 */
import {
  processInstance,
  processInstanceMilestone,
  processInstanceProject,
  processInstanceTask,
  processOccurrence,
  processStep,
  recurrenceSeries,
  recurrenceSeriesRevision,
  type Database,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';
import { parseCalendarDate } from '@docket/planning/calendar-date';
import type { TaskStateMutation } from '../task-state';

import { materializeInstanceSteps } from './materialize-steps';
import type {
  MaterializedOccurrence,
  MaterializeOccurrenceCommand,
  ProcessTransaction,
} from './process-contracts';

export { materializeInstanceSteps } from './materialize-steps';
export type {
  MaterializedOccurrence,
  MaterializedStepDelta,
  MaterializeInstanceStepsCommand,
  MaterializeOccurrenceCommand,
  ProcessTransaction,
} from './process-contracts';

/** Build public key maps from persisted instance mappings. */
async function instanceIdentityMap(
  tx: ProcessTransaction,
  instanceId: string,
  revisionId: string,
): Promise<Omit<MaterializedOccurrence, 'occurrenceId' | 'instanceId'>> {
  const [steps, projects, milestones, tasks] = await Promise.all([
    tx
      .select({ id: processStep.id, key: processStep.key })
      .from(processStep)
      .where(eq(processStep.revisionId, revisionId)),
    tx
      .select({ stepId: processInstanceProject.stepId, entityId: processInstanceProject.projectId })
      .from(processInstanceProject)
      .where(eq(processInstanceProject.instanceId, instanceId)),
    tx
      .select({
        stepId: processInstanceMilestone.stepId,
        entityId: processInstanceMilestone.milestoneId,
      })
      .from(processInstanceMilestone)
      .where(eq(processInstanceMilestone.instanceId, instanceId)),
    tx
      .select({ stepId: processInstanceTask.stepId, entityId: processInstanceTask.taskId })
      .from(processInstanceTask)
      .where(eq(processInstanceTask.instanceId, instanceId)),
  ]);
  const keys = new Map(steps.map((step) => [step.id, step.key]));
  const keyed = (rows: readonly { stepId: string; entityId: string }[]): Record<string, string> =>
    Object.fromEntries(
      rows.flatMap((row) => {
        const key = keys.get(row.stepId);
        return key === undefined ? [] : [[key, row.entityId]];
      }),
    );
  return {
    projectIdsByKey: keyed(projects),
    milestoneIdsByKey: keyed(milestones),
    taskIdsByKey: keyed(tasks),
  };
}

/** The series revision an occurrence executes, with the process revision it is bound to. */
interface SeriesRevisionBinding {
  readonly definitionId: string;
  readonly seriesRevisionId: string;
  readonly processRevisionId: string;
}

/**
 * Read the series revision this occurrence names.
 *
 * @param tx - The open transaction.
 * @param command - The occurrence being materialized.
 * @returns The binding between the series revision and its process revision.
 * @throws {NotFoundError} When the revision does not belong to this series and workspace.
 */
async function loadSeriesRevision(
  tx: ProcessTransaction,
  command: MaterializeOccurrenceCommand,
): Promise<SeriesRevisionBinding> {
  const seriesRows = await tx
    .select({
      definitionId: recurrenceSeries.definitionId,
      seriesRevisionId: recurrenceSeriesRevision.id,
      processRevisionId: recurrenceSeriesRevision.processRevisionId,
    })
    .from(recurrenceSeries)
    .innerJoin(recurrenceSeriesRevision, eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id))
    .where(
      and(
        eq(recurrenceSeries.id, command.seriesId),
        eq(recurrenceSeries.organizationId, command.organizationId),
        eq(recurrenceSeriesRevision.id, command.seriesRevisionId),
      ),
    )
    .limit(1);
  const series = seriesRows[0];
  if (!series) throw new NotFoundError('Recurrence series revision not found');
  return series;
}

/**
 * Insert the expected occurrence if it is not already recorded, then read it back.
 *
 * @remarks
 * The insert is a no-op on conflict and the read that follows is what makes a scheduler retry
 * converge: the second attempt finds the first attempt's row rather than creating a second one. A
 * calendar-bound run is keyed on the provider's occurrence key, everything else on its civil date.
 *
 * @param tx - The open transaction.
 * @param command - The occurrence being materialized.
 * @returns The durable occurrence row.
 * @throws {ConflictError} When it cannot be read back, or already belongs to another revision.
 */
async function ensureOccurrence(tx: ProcessTransaction, command: MaterializeOccurrenceCommand) {
  await tx
    .insert(processOccurrence)
    .values({
      organizationId: command.organizationId,
      seriesId: command.seriesId,
      seriesRevisionId: command.seriesRevisionId,
      scheduledFor: command.scheduledFor,
      originalScheduledFor: command.originalScheduledFor,
      externalOccurrenceKey: command.externalOccurrenceKey,
      createdBy: command.actorId,
    })
    .onConflictDoNothing();
  const occurrenceRows = await tx
    .select()
    .from(processOccurrence)
    .where(
      command.externalOccurrenceKey
        ? and(
            eq(processOccurrence.seriesId, command.seriesId),
            eq(processOccurrence.externalOccurrenceKey, command.externalOccurrenceKey),
          )
        : and(
            eq(processOccurrence.seriesId, command.seriesId),
            eq(processOccurrence.seriesRevisionId, command.seriesRevisionId),
            eq(processOccurrence.scheduledFor, command.scheduledFor),
            isNull(processOccurrence.externalOccurrenceKey),
          ),
    )
    .limit(1);
  const occurrence = occurrenceRows[0];
  if (!occurrence) throw new ConflictError('Occurrence could not be ensured');
  if (occurrence.seriesRevisionId !== command.seriesRevisionId) {
    throw new ConflictError('Occurrence key already belongs to another series revision');
  }
  return occurrence;
}

/**
 * Insert the process instance if it is not already recorded, then take its row lock.
 *
 * @remarks
 * The lock is what serializes two schedulers that reach the same occurrence at once: the second
 * waits, then finds the first one's work already materialized.
 *
 * @param tx - The open transaction.
 * @param command - The occurrence being materialized.
 * @param series - The series revision binding.
 * @param occurrenceId - The occurrence this instance executes.
 * @returns The locked instance row.
 * @throws {ConflictError} When it cannot be read back.
 */
async function ensureLockedInstance(
  tx: ProcessTransaction,
  command: MaterializeOccurrenceCommand,
  series: SeriesRevisionBinding,
  occurrenceId: string,
) {
  await tx
    .insert(processInstance)
    .values({
      organizationId: command.organizationId,
      definitionId: series.definitionId,
      revisionId: series.processRevisionId,
      occurrenceId,
      createdBy: command.actorId,
    })
    .onConflictDoNothing();
  const instanceRows = await tx
    .select()
    .from(processInstance)
    .where(eq(processInstance.occurrenceId, occurrenceId))
    .for('update')
    .limit(1);
  const instance = instanceRows[0];
  if (!instance) throw new ConflictError('Process instance could not be ensured');
  return instance;
}

/** Ensure one occurrence, instance, and eligible fixed/stateful work set exactly once. */
export async function materializeOccurrence(
  database: Database,
  command: MaterializeOccurrenceCommand,
): Promise<MaterializedOccurrence> {
  parseCalendarDate(command.scheduledFor);
  if (command.originalScheduledFor) parseCalendarDate(command.originalScheduledFor);
  const postCommitStateTransitions: TaskStateMutation[] = [];
  const result = await database.transaction(async (tx) => {
    const series = await loadSeriesRevision(tx, command);
    const occurrence = await ensureOccurrence(tx, command);
    const instance = await ensureLockedInstance(tx, command, series, occurrence.id);

    await materializeInstanceSteps(tx, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      instanceId: instance.id,
      revisionId: series.processRevisionId,
      scheduledFor: command.scheduledFor,
      postCommitStateTransitions,
    });
    await tx
      .update(processOccurrence)
      .set({ status: 'materialized' })
      .where(eq(processOccurrence.id, occurrence.id));
    const identities = await instanceIdentityMap(tx, instance.id, series.processRevisionId);
    return {
      occurrenceId: occurrence.id,
      instanceId: instance.id,
      ...identities,
    };
  });
  if (postCommitStateTransitions.length > 0) {
    const { finishTaskStateTransition } = await import('../task-state');
    for (const transition of postCommitStateTransitions) {
      await finishTaskStateTransition({ actorId: null }, transition);
    }
  }
  return result;
}
