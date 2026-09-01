/**
 * `@docket/api` — idempotent process occurrence and concrete work materialization.
 *
 * @remarks
 * Every generated Project, Milestone, and Task is an ordinary Docket row. Source mappings retain
 * the immutable revision step that created it, while unique constraints and an instance row lock
 * make scheduler retries converge on the same work instead of manufacturing duplicates.
 */
import {
  milestone,
  processDependency,
  processInstance,
  processInstanceMilestone,
  processInstanceProject,
  processInstanceTask,
  processMilestoneSpec,
  processOccurrence,
  processProjectLabelSpec,
  processProjectSpec,
  processRevision,
  processStep,
  processTaskLabelSpec,
  processTaskSpec,
  project,
  projectLabel,
  recurrenceSeries,
  recurrenceSeriesRevision,
  task,
  taskDependency,
  taskLabel,
  team,
  type Database,
} from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';
import { addCalendarDays, parseCalendarDate } from '@docket/planning/calendar-date';
import type { TaskStateMutation } from '../task-state';
import { loadStatusSets } from '../work-status';

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
}

/** Convert a validated calendar date to the timestamp convention used by work rows. */
function planningTimestamp(value: string | null): Date | undefined {
  if (value === null) return undefined;
  parseCalendarDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

/** Apply stable, intentionally small naming tokens to a generated entity title. */
function renderName(template: string, scheduledFor: string): string {
  const [year = '', month = ''] = scheduledFor.split('-');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${year}-${month}-01T00:00:00.000Z`),
  );
  return template
    .replaceAll('{date}', scheduledFor)
    .replaceAll('{year}', year)
    .replaceAll('{month}', month)
    .replaceAll('{monthName}', monthName);
}

/** Resolve a step's planning date from trigger-relative or completion-relative timing. */
function stepPlanningDate(
  step: typeof processStep.$inferSelect,
  scheduledFor: string,
  completionDates: ReadonlyMap<string, string>,
): string | null {
  if (step.timingKind === 'on_trigger') return scheduledFor;
  if (step.timingKind === 'relative_to_trigger') {
    return addCalendarDays(scheduledFor, step.offsetDays ?? 0);
  }
  const completedOn = step.afterStepId ? completionDates.get(step.afterStepId) : undefined;
  return completedOn ? addCalendarDays(completedOn, step.offsetDays ?? 0) : null;
}

/** Whether completion timing has its required terminal predecessor. */
function timingReady(
  step: typeof processStep.$inferSelect,
  completionDates: ReadonlyMap<string, string>,
): boolean {
  return (
    step.timingKind !== 'after_step_completion' ||
    (step.afterStepId !== null && completionDates.has(step.afterStepId))
  );
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

/** Require the id returned by a concrete work-row insert. */
function insertedEntityId(rows: readonly { id: string }[], kind: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${kind} insert returned no row`);
  return row.id;
}

/**
 * Materialize every currently eligible step in an already-existing process instance.
 *
 * @remarks
 * The caller must hold the instance row lock. `all_at_once` creates the fixed plan immediately;
 * completion-relative dates remain unset until their predecessor completes. `when_ready` creates a
 * step only when timing, dependency, and containment prerequisites are satisfied.
 */
export async function materializeInstanceSteps(
  tx: ProcessTransaction,
  command: MaterializeInstanceStepsCommand,
): Promise<MaterializedStepDelta> {
  parseCalendarDate(command.scheduledFor);
  const [revisionRows, steps, projectSpecs, milestoneSpecs, taskSpecs, dependencies] =
    await Promise.all([
      tx
        .select()
        .from(processRevision)
        .where(
          and(
            eq(processRevision.id, command.revisionId),
            eq(processRevision.organizationId, command.organizationId),
          ),
        )
        .limit(1),
      tx
        .select()
        .from(processStep)
        .where(eq(processStep.revisionId, command.revisionId))
        .orderBy(processStep.sort),
      tx
        .select()
        .from(processProjectSpec)
        .where(eq(processProjectSpec.organizationId, command.organizationId)),
      tx
        .select()
        .from(processMilestoneSpec)
        .where(eq(processMilestoneSpec.organizationId, command.organizationId)),
      tx
        .select()
        .from(processTaskSpec)
        .where(eq(processTaskSpec.organizationId, command.organizationId)),
      tx
        .select()
        .from(processDependency)
        .where(eq(processDependency.revisionId, command.revisionId)),
    ]);
  const revision = revisionRows[0];
  if (!revision) throw new NotFoundError('Process revision not found');
  const stepIds = new Set(steps.map((step) => step.id));
  const projectsByStep = new Map(
    projectSpecs.filter((spec) => stepIds.has(spec.stepId)).map((spec) => [spec.stepId, spec]),
  );
  const milestonesByStep = new Map(
    milestoneSpecs.filter((spec) => stepIds.has(spec.stepId)).map((spec) => [spec.stepId, spec]),
  );
  const tasksByStep = new Map(
    taskSpecs.filter((spec) => stepIds.has(spec.stepId)).map((spec) => [spec.stepId, spec]),
  );
  const [projectMappings, milestoneMappings, taskMappings, storedTaskLabels, storedProjectLabels] =
    await Promise.all([
      tx
        .select()
        .from(processInstanceProject)
        .where(eq(processInstanceProject.instanceId, command.instanceId)),
      tx
        .select()
        .from(processInstanceMilestone)
        .where(eq(processInstanceMilestone.instanceId, command.instanceId)),
      tx
        .select({
          stepId: processInstanceTask.stepId,
          taskId: processInstanceTask.taskId,
          completedAt: task.completedAt,
        })
        .from(processInstanceTask)
        .innerJoin(task, eq(task.id, processInstanceTask.taskId))
        .where(eq(processInstanceTask.instanceId, command.instanceId)),
      tx
        .select()
        .from(processTaskLabelSpec)
        .where(eq(processTaskLabelSpec.organizationId, command.organizationId)),
      tx
        .select()
        .from(processProjectLabelSpec)
        .where(eq(processProjectLabelSpec.organizationId, command.organizationId)),
    ]);

  const projectIds = new Map(projectMappings.map((row) => [row.stepId, row.projectId]));
  const milestoneIds = new Map(milestoneMappings.map((row) => [row.stepId, row.milestoneId]));
  const taskIds = new Map(taskMappings.map((row) => [row.stepId, row.taskId]));
  const completionDates = new Map(command.completionDatesByStepId ?? []);
  for (const mapping of taskMappings) {
    if (mapping.completedAt && !completionDates.has(mapping.stepId)) {
      completionDates.set(mapping.stepId, mapping.completedAt.toISOString().slice(0, 10));
    }
  }
  const incomingDependencies = new Map<string, string[]>();
  for (const edge of dependencies) {
    const blockers = incomingDependencies.get(edge.blockedStepId) ?? [];
    blockers.push(edge.blockingStepId);
    incomingDependencies.set(edge.blockedStepId, blockers);
  }
  // Every status this materialization might land on, resolved once for the whole run.
  const statusSets = await loadStatusSets(
    command.organizationId,
    { teamIds: taskSpecs.map((spec) => spec.teamId) },
    // Read through the open transaction: the module-level client would issue this on a connection
    // the transaction already holds, which stalls rather than returning stale rows.
    tx,
  );
  const allAtOnce = revision.creationMode === 'all_at_once';
  const createdProjects = new Map<string, string>();
  const createdMilestones = new Map<string, string>();
  const createdTasks = new Map<string, string>();
  const parentTaskIds: (string | null)[] = [];

  for (const step of steps.filter((value) => value.kind === 'project')) {
    if (projectIds.has(step.id) || (!allAtOnce && !timingReady(step, completionDates))) continue;
    const spec = projectsByStep.get(step.id);
    if (!spec) throw new ConflictError('Published project step is missing its specification');
    // A template stores a status key rather than a status, because a workspace may have reshaped
    // its statuses since the template was written; the key is resolved now, or the work lands
    // where new work lands.
    const projectStatus =
      statusSets.for('project').find((candidate) => candidate.key === spec.status) ??
      statusSets.defaultOf('project');
    if (!projectStatus) throw new ConflictError('This workspace has no project statuses');
    const insertedId = insertedEntityId(
      await tx
        .insert(project)
        .values({
          organizationId: command.organizationId,
          name: renderName(spec.name, command.scheduledFor),
          summary: spec.summary,
          description: spec.description,
          leadId: spec.leadId,
          teamId: spec.teamId,
          programId: spec.programId,
          status: projectStatus.key,
          statusId: projectStatus.id,
          health: spec.health,
          startDate: planningTimestamp(
            spec.startOffsetDays === null
              ? stepPlanningDate(step, command.scheduledFor, completionDates)
              : addCalendarDays(command.scheduledFor, spec.startOffsetDays),
          ),
          targetDate: planningTimestamp(
            spec.targetOffsetDays === null
              ? null
              : addCalendarDays(command.scheduledFor, spec.targetOffsetDays),
          ),
          createdBy: command.actorId,
        })
        .returning({ id: project.id }),
      'project',
    );
    await tx.insert(processInstanceProject).values({
      organizationId: command.organizationId,
      instanceId: command.instanceId,
      stepId: step.id,
      projectId: insertedId,
      createdBy: command.actorId,
    });
    const labels = storedProjectLabels.filter((value) => value.projectStepId === step.id);
    if (labels.length > 0) {
      await tx.insert(projectLabel).values(
        labels.map((value) => ({
          organizationId: command.organizationId,
          projectId: insertedId,
          labelId: value.labelId,
        })),
      );
    }
    projectIds.set(step.id, insertedId);
    createdProjects.set(step.key, insertedId);
  }

  for (const step of steps.filter((value) => value.kind === 'milestone')) {
    if (milestoneIds.has(step.id) || (!allAtOnce && !timingReady(step, completionDates))) continue;
    const spec = milestonesByStep.get(step.id);
    if (!spec) throw new ConflictError('Published milestone step is missing its specification');
    const projectId = projectIds.get(spec.projectStepId);
    if (!projectId) continue;
    const insertedId = insertedEntityId(
      await tx
        .insert(milestone)
        .values({
          organizationId: command.organizationId,
          projectId,
          name: renderName(spec.name, command.scheduledFor),
          description: spec.description,
          targetDate: planningTimestamp(
            spec.targetOffsetDays === null
              ? stepPlanningDate(step, command.scheduledFor, completionDates)
              : addCalendarDays(command.scheduledFor, spec.targetOffsetDays),
          ),
          sort: step.sort,
          createdBy: command.actorId,
        })
        .returning({ id: milestone.id }),
      'milestone',
    );
    await tx.insert(processInstanceMilestone).values({
      organizationId: command.organizationId,
      instanceId: command.instanceId,
      stepId: step.id,
      milestoneId: insertedId,
      createdBy: command.actorId,
    });
    milestoneIds.set(step.id, insertedId);
    createdMilestones.set(step.key, insertedId);
  }

  const teamIds = [...new Set([...tasksByStep.values()].map((spec) => spec.teamId))];
  const teamRows = await tx
    .select({ id: team.id, workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.organizationId, command.organizationId), inArray(team.id, teamIds)));
  const teamsById = new Map(teamRows.map((row) => [row.id, row]));

  let progress = true;
  while (progress) {
    progress = false;
    for (const step of steps.filter((value) => value.kind === 'task')) {
      if (taskIds.has(step.id)) continue;
      const spec = tasksByStep.get(step.id);
      if (!spec) throw new ConflictError('Published task step is missing its specification');
      if (!allAtOnce) {
        if (!timingReady(step, completionDates)) continue;
        const blockers = incomingDependencies.get(step.id) ?? [];
        if (blockers.some((blockingStepId) => !completionDates.has(blockingStepId))) continue;
      }
      const projectId = spec.projectStepId
        ? projectIds.get(spec.projectStepId)
        : (spec.projectId ?? undefined);
      const milestoneId = spec.milestoneStepId
        ? milestoneIds.get(spec.milestoneStepId)
        : (spec.milestoneId ?? undefined);
      const parentTaskId = spec.parentTaskStepId
        ? taskIds.get(spec.parentTaskStepId)
        : (spec.parentTaskId ?? undefined);
      if (spec.projectStepId && !projectId) continue;
      if (spec.milestoneStepId && !milestoneId) continue;
      if (spec.parentTaskStepId && !parentTaskId) continue;
      const teamRow = teamsById.get(spec.teamId);
      if (!teamRow) throw new NotFoundError('Generated task team not found');
      const generated =
        spec.state === null
          ? statusSets.defaultOf('task', spec.teamId)
          : statusSets.for('task', spec.teamId).find((candidate) => candidate.key === spec.state);
      if (!generated) throw new ConflictError('Generated task state is not available');
      const state = generated.key;
      const terminalAt = new Date();
      const insertedId = insertedEntityId(
        await tx
          .insert(task)
          .values({
            organizationId: command.organizationId,
            title: renderName(spec.title, command.scheduledFor),
            description: spec.description,
            teamId: spec.teamId,
            statusId: generated.id,
            state,
            priority: spec.priority,
            assigneeId: spec.assigneeId,
            projectId,
            milestoneId,
            cycleId: spec.cycleId,
            parentTaskId,
            estimate: spec.estimate,
            estimateMinutes: spec.estimateMinutes,
            startDate: planningTimestamp(
              spec.startOffsetDays === null
                ? null
                : addCalendarDays(command.scheduledFor, spec.startOffsetDays),
            ),
            dueDate: planningTimestamp(
              spec.dueOffsetDays === null
                ? stepPlanningDate(step, command.scheduledFor, completionDates)
                : addCalendarDays(command.scheduledFor, spec.dueOffsetDays),
            ),
            completedAt: generated.category === 'completed' ? terminalAt : undefined,
            canceledAt: generated.category === 'canceled' ? terminalAt : undefined,
            source: 'native',
            createdBy: command.actorId,
          })
          .returning({ id: task.id }),
        'task',
      );
      await tx.insert(processInstanceTask).values({
        organizationId: command.organizationId,
        instanceId: command.instanceId,
        stepId: step.id,
        taskId: insertedId,
        createdBy: command.actorId,
      });
      const labels = storedTaskLabels.filter((value) => value.taskStepId === step.id);
      if (labels.length > 0) {
        await tx.insert(taskLabel).values(
          labels.map((value) => ({
            organizationId: command.organizationId,
            taskId: insertedId,
            labelId: value.labelId,
          })),
        );
      }
      taskIds.set(step.id, insertedId);
      createdTasks.set(step.key, insertedId);
      parentTaskIds.push(parentTaskId ?? null);
      progress = true;
    }
  }

  for (const edge of dependencies) {
    const blockingTaskId = taskIds.get(edge.blockingStepId);
    const blockedTaskId = taskIds.get(edge.blockedStepId);
    if (!blockingTaskId || !blockedTaskId) continue;
    await tx
      .insert(taskDependency)
      .values({ blockingTaskId, blockedTaskId, organizationId: command.organizationId })
      .onConflictDoNothing();
  }

  if (parentTaskIds.length > 0) {
    const { applySubtaskCompletionPolicyForParents } = await import('../task-state');
    const cascades = await applySubtaskCompletionPolicyForParents(
      tx,
      command.organizationId,
      parentTaskIds,
    );
    command.postCommitStateTransitions?.push(...cascades);
  }

  return {
    createdProjectIdsByKey: Object.fromEntries(createdProjects),
    createdMilestoneIdsByKey: Object.fromEntries(createdMilestones),
    createdTaskIdsByKey: Object.fromEntries(createdTasks),
  };
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
