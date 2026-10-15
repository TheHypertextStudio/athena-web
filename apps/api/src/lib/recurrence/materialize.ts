/** Idempotent scheduler occurrence identity with work delegated to shared canonical creation. */
import {
  processInstance,
  processOccurrence,
  processStep,
  processInstanceProject,
  processInstanceMilestone,
  processInstanceTask,
  recurrenceSeries,
  recurrenceSeriesRevision,
  type Database,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { parseCalendarDate } from '@docket/work/calendar-date';
import { ConflictError, NotFoundError } from '../../error';
import type { TaskStateMutation } from '../task-state';
import type { DeferredWorkEffect } from '../work-creation/types';
import { deferWorkCreationEffects } from '../work-creation/effects';
import { materializeTemplateOccurrence } from './work-template-adapter';
import { moveRetainedOccurrence } from './work-template-move';
/** Transaction handle shared with completion advancement. */
export type ProcessTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Command for ensuring and materializing one expected process occurrence. */
export interface MaterializeOccurrenceCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with generated work. */
  readonly actorId?: string | undefined;
  /** Recurrence series being executed. */
  readonly seriesId: string;
  /** Immutable schedule/process binding selected for this occurrence. */
  readonly seriesRevisionId: string;
  /** Expected civil date. */
  readonly scheduledFor: string;
  /** Original date when this is a rescheduled occurrence. */
  readonly originalScheduledFor?: string | undefined;
  /** Stable provider-side occurrence key for calendar-bound runs. */
  readonly externalOccurrenceKey?: string | undefined;
}

/** Complete identity map for one materialized process occurrence. */
export interface MaterializedOccurrence {
  /** Durable expected occurrence id. */
  readonly occurrenceId: string;
  /** Concrete process execution id. */
  readonly instanceId: string;
  /** Generated Projects keyed by authored step key. */
  readonly projectIdsByKey: Readonly<Record<string, string>>;
  /** Generated Milestones keyed by authored step key. */
  readonly milestoneIdsByKey: Readonly<Record<string, string>>;
  /** Generated Tasks keyed by authored step key. */
  readonly taskIdsByKey: Readonly<Record<string, string>>;
}

/** Newly generated entity identities from one readiness pass. */
export interface MaterializedStepDelta {
  /** Projects created by this pass. */
  readonly createdProjectIdsByKey: Readonly<Record<string, string>>;
  /** Milestones created by this pass. */
  readonly createdMilestoneIdsByKey: Readonly<Record<string, string>>;
  /** Tasks created by this pass. */
  readonly createdTaskIdsByKey: Readonly<Record<string, string>>;
}

/** Context for a readiness pass inside an already locked instance transaction. */
export interface MaterializeInstanceStepsCommand {
  /** Owning workspace. */
  readonly organizationId: string;
  /** Actor credited with newly generated entities. */
  readonly actorId?: string | undefined;
  /** Existing process instance. */
  readonly instanceId: string;
  /** Immutable process revision. */
  readonly revisionId: string;
  /** Civil date that triggered the occurrence. */
  readonly scheduledFor: string;
  /** Exact completion dates observed during this transition, keyed by source step id. */
  readonly completionDatesByStepId?: ReadonlyMap<string, string> | undefined;
  /** State changes that the caller must publish after its enclosing transaction commits. */
  readonly postCommitStateTransitions?: TaskStateMutation[] | undefined;
  /** Deferred shared creation effects drained by the enclosing transaction owner. */
  readonly postCommitEffects?: DeferredWorkEffect[];
}

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

/** Complete all missing selected legacy work once at the approved canonical cutover, preserving existing source maps. */
export async function materializeInstanceSteps(
  tx: ProcessTransaction,
  command: MaterializeInstanceStepsCommand,
): Promise<MaterializedStepDelta> {
  const [binding] = await tx
    .select({
      seriesId: processOccurrence.seriesId,
      seriesRevisionId: processOccurrence.seriesRevisionId,
      occurrenceId: processOccurrence.id,
    })
    .from(processInstance)
    .innerJoin(
      processOccurrence,
      and(
        eq(processOccurrence.id, processInstance.occurrenceId),
        eq(processOccurrence.organizationId, command.organizationId),
      ),
    )
    .where(
      and(
        eq(processInstance.id, command.instanceId),
        eq(processInstance.organizationId, command.organizationId),
        eq(processInstance.revisionId, command.revisionId),
      ),
    )
    .limit(1);
  if (!binding) throw new NotFoundError('Recurrence instance not found');
  const result = await materializeTemplateOccurrence(tx, {
    ...binding,
    organizationId: command.organizationId,
    instanceId: command.instanceId,
    actorId: command.actorId,
  });
  if (command.postCommitEffects) command.postCommitEffects.push(...result.effects);
  else if (result.effects.length)
    throw new ConflictError('Creation effects require an enclosing transaction owner');
  return result.delta;
}
/** Ensure one occurrence, instance, and eligible fixed/stateful work set exactly once. */
export async function materializeOccurrence(
  database: Database,
  command: MaterializeOccurrenceCommand,
): Promise<MaterializedOccurrence> {
  parseCalendarDate(command.scheduledFor);
  if (command.originalScheduledFor) parseCalendarDate(command.originalScheduledFor);
  const postCommitEffects: DeferredWorkEffect[] = [];
  const result = await database.transaction(async (tx) => {
    const seriesRows = await tx
      .select({
        definitionId: recurrenceSeries.definitionId,
        seriesRevisionId: recurrenceSeriesRevision.id,
        processRevisionId: recurrenceSeriesRevision.processRevisionId,
      })
      .from(recurrenceSeries)
      .innerJoin(
        recurrenceSeriesRevision,
        eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id),
      )
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
    await tx
      .insert(processInstance)
      .values({
        organizationId: command.organizationId,
        definitionId: series.definitionId,
        revisionId: series.processRevisionId,
        occurrenceId: occurrence.id,
        createdBy: command.actorId,
      })
      .onConflictDoNothing();
    const instanceRows = await tx
      .select()
      .from(processInstance)
      .where(eq(processInstance.occurrenceId, occurrence.id))
      .for('update')
      .limit(1);
    const instance = instanceRows[0];
    if (!instance) throw new ConflictError('Process instance could not be ensured');

    if (command.externalOccurrenceKey)
      postCommitEffects.push(
        ...(await moveRetainedOccurrence(tx, {
          ...command,
          externalOccurrenceKey: command.externalOccurrenceKey,
          occurrenceId: occurrence.id,
          instanceId: instance.id,
        })),
      );

    await materializeInstanceSteps(tx, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      instanceId: instance.id,
      revisionId: series.processRevisionId,
      scheduledFor: command.scheduledFor,
      postCommitEffects,
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
  deferWorkCreationEffects(postCommitEffects);
  return result;
}
