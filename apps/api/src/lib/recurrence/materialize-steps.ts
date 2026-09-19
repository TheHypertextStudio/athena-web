/**
 * `@docket/api` — turning one process revision's steps into concrete Docket work.
 *
 * @remarks
 * Split out of `./materialize`, which owns the occurrence and instance rows this runs inside. Each
 * kind of step becomes an ordinary row of its own table — a Project, a Milestone, a Task — and the
 * only thing that distinguishes generated work from captured work is the instance mapping that
 * records which immutable step created it.
 *
 * Readiness is the subject here. `all_at_once` creates the fixed plan immediately, so only
 * containment can hold a step back; `when_ready` additionally requires a step's timing and its
 * blocking dependencies to be satisfied, which is why the task pass runs to a fixed point rather
 * than once: creating one task can make the next one's parent or blocker resolvable.
 */
import {
  milestone,
  processDependency,
  processInstanceMilestone,
  processInstanceProject,
  processInstanceTask,
  processMilestoneSpec,
  processProjectLabelSpec,
  processProjectSpec,
  processRevision,
  processStep,
  processTaskLabelSpec,
  processTaskSpec,
  project,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  team,
} from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../../error';
import { parseCalendarDate } from '@docket/planning/calendar-date';
import { loadStatusSets } from '../work-status';

import {
  offsetDate,
  renderName,
  stepPlanningDate,
  terminalStamp,
  timingReady,
} from './step-planning';

import type {
  MaterializedStepDelta,
  MaterializeInstanceStepsCommand,
  ProcessTransaction,
} from './process-contracts';

type StepRow = typeof processStep.$inferSelect;
type StatusSets = Awaited<ReturnType<typeof loadStatusSets>>;

/** Require the id returned by a concrete work-row insert. */
function insertedEntityId(rows: readonly { id: string }[], kind: string): string {
  const row = rows[0];
  if (!row) throw new Error(`${kind} insert returned no row`);
  return row.id;
}

/**
 * Everything one readiness pass reads, resolved before any row is written.
 *
 * @remarks
 * The id maps are mutable on purpose: a project created by this pass is the container a milestone
 * or task created later in the same pass files itself under.
 */
interface StepPass {
  readonly tx: ProcessTransaction;
  readonly command: MaterializeInstanceStepsCommand;
  readonly steps: readonly StepRow[];
  /** Whether the revision creates its full fixed plan rather than releasing steps when ready. */
  readonly allAtOnce: boolean;
  /** Completion dates observed so far, keyed by the step that completed. */
  readonly completionDates: Map<string, string>;
  readonly statusSets: StatusSets;
  readonly projectsByStep: ReadonlyMap<string, typeof processProjectSpec.$inferSelect>;
  readonly milestonesByStep: ReadonlyMap<string, typeof processMilestoneSpec.$inferSelect>;
  readonly tasksByStep: ReadonlyMap<string, typeof processTaskSpec.$inferSelect>;
  readonly storedProjectLabels: readonly (typeof processProjectLabelSpec.$inferSelect)[];
  readonly storedTaskLabels: readonly (typeof processTaskLabelSpec.$inferSelect)[];
  readonly dependencies: readonly (typeof processDependency.$inferSelect)[];
  /** Blocking step ids keyed by the step they block. */
  readonly incomingDependencies: ReadonlyMap<string, readonly string[]>;
  readonly projectIds: Map<string, string>;
  readonly milestoneIds: Map<string, string>;
  readonly taskIds: Map<string, string>;
}

/**
 * Read the immutable revision and every specification it published.
 *
 * @param tx - The open instance transaction.
 * @param command - The readiness pass being run.
 * @returns The revision and its steps, specs, and dependency edges.
 * @throws {NotFoundError} When the revision does not belong to this workspace.
 */
async function loadRevision(tx: ProcessTransaction, command: MaterializeInstanceStepsCommand) {
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
  return { revision, steps, projectSpecs, milestoneSpecs, taskSpecs, dependencies };
}

/**
 * Read what this instance has already materialized, and the labels its work carries.
 *
 * @param tx - The open instance transaction.
 * @param command - The readiness pass being run.
 * @returns The existing step-to-entity mappings and the label specifications.
 */
async function loadInstanceState(tx: ProcessTransaction, command: MaterializeInstanceStepsCommand) {
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
  return {
    projectMappings,
    milestoneMappings,
    taskMappings,
    storedTaskLabels,
    storedProjectLabels,
  };
}

/**
 * Read the revision, its steps and specs, and whatever this instance already materialized.
 *
 * @param tx - The open instance transaction.
 * @param command - The readiness pass being run.
 * @returns The resolved pass.
 * @throws {NotFoundError} When the revision does not belong to this workspace.
 */
export async function loadStepPass(
  tx: ProcessTransaction,
  command: MaterializeInstanceStepsCommand,
): Promise<StepPass> {
  const { revision, steps, projectSpecs, milestoneSpecs, taskSpecs, dependencies } =
    await loadRevision(tx, command);
  const stepIds = new Set(steps.map((step) => step.id));
  const {
    projectMappings,
    milestoneMappings,
    taskMappings,
    storedTaskLabels,
    storedProjectLabels,
  } = await loadInstanceState(tx, command);

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

  return {
    tx,
    command,
    steps,
    allAtOnce: revision.creationMode === 'all_at_once',
    completionDates,
    // Every status this materialization might land on, resolved once for the whole run. Read
    // through the open transaction: the module-level client would issue this on a connection the
    // transaction already holds, which stalls rather than returning stale rows.
    statusSets: await loadStatusSets(
      command.organizationId,
      { teamIds: taskSpecs.map((spec) => spec.teamId) },
      tx,
    ),
    projectsByStep: new Map(
      projectSpecs.filter((spec) => stepIds.has(spec.stepId)).map((spec) => [spec.stepId, spec]),
    ),
    milestonesByStep: new Map(
      milestoneSpecs.filter((spec) => stepIds.has(spec.stepId)).map((spec) => [spec.stepId, spec]),
    ),
    tasksByStep: new Map(
      taskSpecs.filter((spec) => stepIds.has(spec.stepId)).map((spec) => [spec.stepId, spec]),
    ),
    storedProjectLabels,
    storedTaskLabels,
    dependencies,
    incomingDependencies,
    projectIds: new Map(projectMappings.map((row) => [row.stepId, row.projectId])),
    milestoneIds: new Map(milestoneMappings.map((row) => [row.stepId, row.milestoneId])),
    taskIds: new Map(taskMappings.map((row) => [row.stepId, row.taskId])),
  };
}

/**
 * Create the Projects this pass is ready to create.
 *
 * @param pass - The resolved readiness pass.
 * @returns The created project ids, keyed by authored step key.
 */
async function materializeProjects(pass: StepPass): Promise<Map<string, string>> {
  const { tx, command, statusSets } = pass;
  const created = new Map<string, string>();
  for (const step of pass.steps.filter((value) => value.kind === 'project')) {
    if (
      pass.projectIds.has(step.id) ||
      (!pass.allAtOnce && !timingReady(step, pass.completionDates))
    )
      continue;
    const spec = pass.projectsByStep.get(step.id);
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
          startDate: offsetDate(
            command.scheduledFor,
            spec.startOffsetDays,
            stepPlanningDate(step, command.scheduledFor, pass.completionDates),
          ),
          targetDate: offsetDate(command.scheduledFor, spec.targetOffsetDays, null),
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
    const labels = pass.storedProjectLabels.filter((value) => value.projectStepId === step.id);
    if (labels.length > 0) {
      await tx.insert(projectLabel).values(
        labels.map((value) => ({
          organizationId: command.organizationId,
          projectId: insertedId,
          labelId: value.labelId,
        })),
      );
    }
    pass.projectIds.set(step.id, insertedId);
    created.set(step.key, insertedId);
  }
  return created;
}

/**
 * Create the Milestones whose project container already exists.
 *
 * @param pass - The resolved readiness pass.
 * @returns The created milestone ids, keyed by authored step key.
 */
async function materializeMilestones(pass: StepPass): Promise<Map<string, string>> {
  const { tx, command } = pass;
  const created = new Map<string, string>();
  for (const step of pass.steps.filter((value) => value.kind === 'milestone')) {
    if (
      pass.milestoneIds.has(step.id) ||
      (!pass.allAtOnce && !timingReady(step, pass.completionDates))
    ) {
      continue;
    }
    const spec = pass.milestonesByStep.get(step.id);
    if (!spec) throw new ConflictError('Published milestone step is missing its specification');
    const projectId = pass.projectIds.get(spec.projectStepId);
    if (!projectId) continue;
    const insertedId = insertedEntityId(
      await tx
        .insert(milestone)
        .values({
          organizationId: command.organizationId,
          projectId,
          name: renderName(spec.name, command.scheduledFor),
          description: spec.description,
          targetDate: offsetDate(
            command.scheduledFor,
            spec.targetOffsetDays,
            stepPlanningDate(step, command.scheduledFor, pass.completionDates),
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
    pass.milestoneIds.set(step.id, insertedId);
    created.set(step.key, insertedId);
  }
  return created;
}

/** The containers a task step files itself under, once they are known to exist. */
interface TaskContainers {
  readonly projectId: string | undefined;
  readonly milestoneId: string | undefined;
  readonly parentTaskId: string | undefined;
}

/**
 * Resolve a task step's containers, preferring a generated one over a fixed id.
 *
 * @param pass - The resolved readiness pass.
 * @param spec - The task specification.
 * @returns The containers, or `null` when one it names has not been created yet.
 */
function taskContainers(
  pass: StepPass,
  spec: typeof processTaskSpec.$inferSelect,
): TaskContainers | null {
  const projectId = containerId(spec.projectStepId, spec.projectId, pass.projectIds);
  const milestoneId = containerId(spec.milestoneStepId, spec.milestoneId, pass.milestoneIds);
  const parentTaskId = containerId(spec.parentTaskStepId, spec.parentTaskId, pass.taskIds);
  if (projectId === null || milestoneId === null || parentTaskId === null) return null;
  return { projectId, milestoneId, parentTaskId };
}

/**
 * Resolve one container reference, preferring the generated step over the fixed id.
 *
 * @param stepId - The step whose generated entity this container is, when it is one.
 * @param fixedId - The entity id the specification named outright, when it named one.
 * @param created - The ids this instance has materialized so far, keyed by step.
 * @returns The container id, `undefined` when unset, or `null` when it is not created yet.
 */
function containerId(
  stepId: string | null,
  fixedId: string | null,
  created: ReadonlyMap<string, string>,
): string | undefined | null {
  if (stepId === null) return fixedId ?? undefined;
  return created.get(stepId) ?? null;
}

/** Whether a `when_ready` revision has released this task step yet. */
function taskReleased(pass: StepPass, step: StepRow): boolean {
  if (pass.allAtOnce) return true;
  if (!timingReady(step, pass.completionDates)) return false;
  const blockers = pass.incomingDependencies.get(step.id) ?? [];
  return !blockers.some((blockingStepId) => !pass.completionDates.has(blockingStepId));
}

/** What one task pass created, and which parents it needs the completion policy re-run for. */
interface TaskPassResult {
  readonly created: Map<string, string>;
  readonly parentTaskIds: (string | null)[];
}

/**
 * Create the Tasks this pass is ready to create, repeating until nothing new resolves.
 *
 * @remarks
 * A fixed point rather than a single sweep: creating one task can make the next one's parent or
 * blocker resolvable, and the steps are ordered by author intent rather than by dependency.
 *
 * @param pass - The resolved readiness pass.
 * @returns The created task ids and the parents whose completion policy must be re-evaluated.
 */
async function materializeTasks(pass: StepPass): Promise<TaskPassResult> {
  const { tx, command } = pass;
  const teamIds = [...new Set([...pass.tasksByStep.values()].map((spec) => spec.teamId))];
  const teamRows = await tx
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, command.organizationId), inArray(team.id, teamIds)));
  const knownTeamIds = new Set(teamRows.map((row) => row.id));

  const created = new Map<string, string>();
  const parentTaskIds: (string | null)[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const step of pass.steps.filter((value) => value.kind === 'task')) {
      const insertedParentId = await materializeOneTask(pass, step, knownTeamIds, created);
      if (insertedParentId === undefined) continue;
      parentTaskIds.push(insertedParentId);
      progress = true;
    }
  }
  return { created, parentTaskIds };
}

/**
 * Create one task step, when everything it waits on is in place.
 *
 * @param pass - The resolved readiness pass.
 * @param step - The task step to try.
 * @param knownTeamIds - The teams this workspace has, so a stale team is refused rather than used.
 * @param created - The created ids, keyed by authored step key; written on success.
 * @returns The new task's parent id (`null` when it has none), or `undefined` when it was skipped.
 * @throws {ConflictError} When the published step has no specification or no available state.
 * @throws {NotFoundError} When the step names a team this workspace no longer has.
 */
async function materializeOneTask(
  pass: StepPass,
  step: StepRow,
  knownTeamIds: ReadonlySet<string>,
  created: Map<string, string>,
): Promise<string | null | undefined> {
  const { tx, command, statusSets } = pass;
  if (pass.taskIds.has(step.id)) return undefined;
  const spec = pass.tasksByStep.get(step.id);
  if (!spec) throw new ConflictError('Published task step is missing its specification');
  if (!taskReleased(pass, step)) return undefined;
  const containers = taskContainers(pass, spec);
  if (!containers) return undefined;
  if (!knownTeamIds.has(spec.teamId)) throw new NotFoundError('Generated task team not found');

  const generated =
    spec.state === null
      ? statusSets.defaultOf('task', spec.teamId)
      : statusSets.for('task', spec.teamId).find((candidate) => candidate.key === spec.state);
  if (!generated) throw new ConflictError('Generated task state is not available');
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
        state: generated.key,
        priority: spec.priority,
        assigneeId: spec.assigneeId,
        projectId: containers.projectId,
        milestoneId: containers.milestoneId,
        cycleId: spec.cycleId,
        parentTaskId: containers.parentTaskId,
        estimate: spec.estimate,
        estimateMinutes: spec.estimateMinutes,
        startDate: offsetDate(command.scheduledFor, spec.startOffsetDays, null),
        dueDate: offsetDate(
          command.scheduledFor,
          spec.dueOffsetDays,
          stepPlanningDate(step, command.scheduledFor, pass.completionDates),
        ),
        ...terminalStamp(generated.category, terminalAt),
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
  const labels = pass.storedTaskLabels.filter((value) => value.taskStepId === step.id);
  if (labels.length > 0) {
    await tx.insert(taskLabel).values(
      labels.map((value) => ({
        organizationId: command.organizationId,
        taskId: insertedId,
        labelId: value.labelId,
      })),
    );
  }
  pass.taskIds.set(step.id, insertedId);
  created.set(step.key, insertedId);
  return containers.parentTaskId ?? null;
}

/**
 * Mirror the revision's step dependencies onto the tasks that materialized from them.
 *
 * @param pass - The resolved readiness pass.
 */
async function linkTaskDependencies(pass: StepPass): Promise<void> {
  for (const edge of pass.dependencies) {
    const blockingTaskId = pass.taskIds.get(edge.blockingStepId);
    const blockedTaskId = pass.taskIds.get(edge.blockedStepId);
    if (!blockingTaskId || !blockedTaskId) continue;
    await pass.tx
      .insert(taskDependency)
      .values({
        blockingTaskId,
        blockedTaskId,
        organizationId: pass.command.organizationId,
      })
      .onConflictDoNothing();
  }
}

/**
 * Materialize every currently eligible step in an already-existing process instance.
 *
 * @remarks
 * The caller must hold the instance row lock. `all_at_once` creates the fixed plan immediately;
 * completion-relative dates remain unset until their predecessor completes. `when_ready` creates a
 * step only when timing, dependency, and containment prerequisites are satisfied.
 *
 * @param tx - The open instance transaction.
 * @param command - The readiness pass to run.
 * @returns The entities this pass created, keyed by authored step key.
 */
export async function materializeInstanceSteps(
  tx: ProcessTransaction,
  command: MaterializeInstanceStepsCommand,
): Promise<MaterializedStepDelta> {
  parseCalendarDate(command.scheduledFor);
  const pass = await loadStepPass(tx, command);

  const createdProjects = await materializeProjects(pass);
  const createdMilestones = await materializeMilestones(pass);
  const { created: createdTasks, parentTaskIds } = await materializeTasks(pass);
  await linkTaskDependencies(pass);

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
