/**
 * `@docket/api` — completion-driven process advancement and series continuation.
 *
 * @remarks
 * Task completion is an event, not a polling inference. This service releases newly-ready steps,
 * assigns actual-completion-relative planning dates, closes fully completed instances, and creates
 * the next completion-anchored occurrence. Replaying the same event is intentionally harmless.
 */
import {
  processInstance,
  processInstanceTask,
  processOccurrence,
  processStep,
  processTaskSpec,
  recurrenceSeriesRevision,
  task,
  type Database,
} from '@docket/db';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';

import {
  addCalendarDays,
  addCalendarMonths,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
} from '@docket/planning/calendar-date';
import { materializeOccurrence, type MaterializedStepDelta } from './materialize';
import type { DeferredWorkEffect } from '../work-creation/types';
import { deferWorkCreationEffects } from '../work-creation/effects';
import { advanceTemplateOccurrence } from './work-template-advance';

/** Command emitted from an actual task transition into a completed workflow state. */
export interface AdvanceCompletedProcessTaskCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with any work released by the transition. */
  readonly actorId?: string | undefined;
  /** Concrete generated Task that completed. */
  readonly completedTaskId: string;
  /** Calendar date of actual completion in the process's planning context. */
  readonly completedOn: string;
}

/** Outcome of one idempotent completion advancement pass. */
export interface ProcessAdvanceResult {
  /** Newly released Projects keyed by authored step key. */
  readonly createdProjectIdsByKey: Readonly<Record<string, string>>;
  /** Newly released Milestones keyed by authored step key. */
  readonly createdMilestoneIdsByKey: Readonly<Record<string, string>>;
  /** Newly released Tasks keyed by authored step key. */
  readonly createdTaskIdsByKey: Readonly<Record<string, string>>;
  /** Whether this transition left the whole process instance completed. */
  readonly instanceCompleted: boolean;
  /** Next occurrence for completion-anchored series, or null for other/incomplete processes. */
  readonly nextOccurrenceId: string | null;
}

const EMPTY_DELTA: MaterializedStepDelta = {
  createdProjectIdsByKey: {},
  createdMilestoneIdsByKey: {},
  createdTaskIdsByKey: {},
};

/** Add a completion-anchored interval, clamping month ends intuitively. */
function nextCompletionDate(
  completedOn: string,
  interval: number,
  unit: 'day' | 'week' | 'month',
): string {
  if (unit === 'day') return addCalendarDays(completedOn, interval);
  if (unit === 'week') return addCalendarDays(completedOn, interval * 7);
  const source = parseCalendarDate(completedOn);
  const target = addCalendarMonths(completedOn, interval);
  return formatCalendarDate({
    year: target.year,
    month: target.month,
    day: Math.min(source.day, daysInMonth(target.year, target.month)),
  });
}

/** Whether every task specification has one concrete completed Task. */
async function processTasksComplete(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  revisionId: string,
  instanceId: string,
): Promise<boolean> {
  const taskStepIds = (
    await tx
      .select({ id: processStep.id })
      .from(processStep)
      .innerJoin(processTaskSpec, eq(processTaskSpec.stepId, processStep.id))
      .where(eq(processStep.revisionId, revisionId))
  ).map((row) => row.id);
  if (taskStepIds.length === 0) return true;
  const mappings = await tx
    .select({ stepId: processInstanceTask.stepId, completedAt: task.completedAt })
    .from(processInstanceTask)
    .innerJoin(task, eq(task.id, processInstanceTask.taskId))
    .where(
      and(
        eq(processInstanceTask.instanceId, instanceId),
        inArray(processInstanceTask.stepId, taskStepIds),
      ),
    );
  return (
    mappings.length === taskStepIds.length && mappings.every((row) => row.completedAt !== null)
  );
}

function retainedReflowEffects(
  reflow: Awaited<ReturnType<typeof advanceTemplateOccurrence>>['reflow'],
): DeferredWorkEffect[] {
  return reflow.rows.map((work) => ({
    kind: 'search',
    dedupeKey: `search:${work.kind}:${work.id}`,
    work,
  }));
}

/** Release process work and completion-anchored continuation from one actual task completion. */
export async function advanceCompletedProcessTask(
  database: Database,
  command: AdvanceCompletedProcessTaskCommand,
): Promise<ProcessAdvanceResult> {
  parseCalendarDate(command.completedOn);
  const postCommitEffects: DeferredWorkEffect[] = [];
  const transition = await database.transaction(async (tx) => {
    const mappedRows = await tx
      .select({
        instanceId: processInstanceTask.instanceId,
        completedStepId: processInstanceTask.stepId,
        revisionId: processInstance.revisionId,
        occurrenceId: processInstance.occurrenceId,
        instanceStatus: processInstance.status,
        scheduledFor: processOccurrence.scheduledFor,
        seriesId: processOccurrence.seriesId,
        seriesRevisionId: processOccurrence.seriesRevisionId,
      })
      .from(processInstanceTask)
      .innerJoin(processInstance, eq(processInstance.id, processInstanceTask.instanceId))
      .leftJoin(processOccurrence, eq(processOccurrence.id, processInstance.occurrenceId))
      .where(
        and(
          eq(processInstanceTask.taskId, command.completedTaskId),
          eq(processInstanceTask.organizationId, command.organizationId),
        ),
      )
      .limit(1);
    const mapped = mappedRows[0];
    if (
      !mapped?.occurrenceId ||
      !mapped.scheduledFor ||
      !mapped.seriesId ||
      !mapped.seriesRevisionId
    ) {
      return { delta: EMPTY_DELTA, complete: false, next: null };
    }
    await tx
      .select({ id: processInstance.id })
      .from(processInstance)
      .where(eq(processInstance.id, mapped.instanceId))
      .for('update')
      .limit(1);

    const completedTask = await tx
      .select({ completedAt: task.completedAt })
      .from(task)
      .where(
        and(eq(task.id, command.completedTaskId), eq(task.organizationId, command.organizationId)),
      )
      .limit(1);
    if (!completedTask[0]?.completedAt) {
      return { delta: EMPTY_DELTA, complete: false, next: null };
    }

    const advanced = await advanceTemplateOccurrence(
      tx,
      {
        organizationId: command.organizationId,
        actorId: command.actorId,
        instanceId: mapped.instanceId,
        seriesId: mapped.seriesId,
        seriesRevisionId: mapped.seriesRevisionId,
        occurrenceId: mapped.occurrenceId,
      },
      command.completedTaskId,
    );
    const delta = advanced.delta;
    postCommitEffects.push(...advanced.effects);
    postCommitEffects.push(...retainedReflowEffects(advanced.reflow));

    const complete = await processTasksComplete(tx, mapped.revisionId, mapped.instanceId);
    if (!complete) return { delta, complete: false, next: null };

    if (mapped.instanceStatus !== 'completed') {
      await tx
        .update(processInstance)
        .set({ status: 'completed', completedAt: completedTask[0].completedAt })
        .where(eq(processInstance.id, mapped.instanceId));
      await tx
        .update(processOccurrence)
        .set({ status: 'completed', resolvedAt: completedTask[0].completedAt })
        .where(eq(processOccurrence.id, mapped.occurrenceId));
    }

    const currentSeriesRevision = await tx
      .select()
      .from(recurrenceSeriesRevision)
      .where(eq(recurrenceSeriesRevision.id, mapped.seriesRevisionId))
      .limit(1);
    const trigger = currentSeriesRevision[0];
    if (
      trigger?.triggerKind !== 'after_completion' ||
      trigger.interval === null ||
      trigger.intervalUnit === null
    ) {
      return { delta, complete: true, next: null };
    }
    const nextDate = nextCompletionDate(
      command.completedOn,
      trigger.interval,
      trigger.intervalUnit,
    );
    const futureRevision = await tx
      .select({
        id: recurrenceSeriesRevision.id,
        processRevisionId: recurrenceSeriesRevision.processRevisionId,
      })
      .from(recurrenceSeriesRevision)
      .where(
        and(
          eq(recurrenceSeriesRevision.seriesId, mapped.seriesId),
          lte(recurrenceSeriesRevision.effectiveFrom, nextDate),
        ),
      )
      .orderBy(desc(recurrenceSeriesRevision.effectiveFrom), desc(recurrenceSeriesRevision.number))
      .limit(1);
    return {
      delta,
      complete: true,
      next: futureRevision[0]
        ? {
            seriesId: mapped.seriesId,
            seriesRevisionId: futureRevision[0].id,
            scheduledFor: nextDate,
          }
        : null,
    };
  });

  deferWorkCreationEffects(postCommitEffects);

  let nextOccurrenceId: string | null = null;
  if (transition.next) {
    const next = await materializeOccurrence(database, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      ...transition.next,
    });
    nextOccurrenceId = next.occurrenceId;
  }
  return {
    ...transition.delta,
    instanceCompleted: transition.complete,
    nextOccurrenceId,
  };
}
