/**
 * `@docket/api` — validated, normalized authoring of immutable process revisions.
 *
 * @remarks
 * A process definition is the named lifecycle container; every executable graph is an immutable
 * published revision. Materialized instances retain their revision id, so publishing a future
 * revision cannot rewrite work that already exists.
 */
import {
  actor,
  cycle,
  genId,
  label,
  milestone,
  processDefinition,
  processDependency,
  processMilestoneSpec,
  processProjectLabelSpec,
  processProjectSpec,
  processRevision,
  processStep,
  processTaskLabelSpec,
  processTaskSpec,
  program,
  project,
  projectLabel,
  recurrenceSeries,
  task,
  taskDependency,
  taskLabel,
  team,
  type Database,
} from '@docket/db';
import {
  ActorId,
  LabelId,
  ProcessDefinitionCreate,
  ProcessDefinitionDetailOut,
  ProcessDefinitionSummaryOut,
  ProcessDefinitionUpdate,
  type ProcessDefinitionCreate as ProcessDefinitionCreateValue,
  type ProcessDefinitionFromProjectCreate,
  type ProcessStepTiming,
  ProgramId,
  TeamId,
} from '@docket/types';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, CycleError, NotFoundError } from '../../error';
import { calendarDaysBetween } from './calendar-date';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Command for creating and immediately publishing a reusable process. */
export interface CreatePublishedProcessDefinitionCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the definition and normalized rows. */
  readonly actorId?: string;
  /** Fully validated graph and reusable work specifications. */
  readonly definition: ProcessDefinitionCreateValue;
}

/** Command for appending a new immutable revision to an existing process. */
export interface AppendPublishedProcessRevisionCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the new revision. */
  readonly actorId?: string;
  /** Existing definition receiving the revision. */
  readonly definitionId: string;
  /** Replacement graph used only by future instances. */
  readonly revision: ProcessDefinitionCreateValue;
}

/** Identities returned after one process revision is published. */
export interface PublishedProcessRevision {
  /** Stable definition identity. */
  readonly definitionId: string;
  /** Immutable revision identity. */
  readonly revisionId: string;
  /** Monotonic revision number within the definition. */
  readonly revisionNumber: number;
  /** Stable authored keys mapped to their normalized row ids. */
  readonly stepIdsByKey: Readonly<Record<string, string>>;
}

/** Command for turning one ordinary project into a reusable process snapshot. */
export interface CreateProcessDefinitionFromProjectCommand {
  readonly organizationId: string;
  readonly actorId?: string;
  readonly input: ProcessDefinitionFromProjectCreate;
  readonly now?: Date;
}

/** Convert a persisted planning timestamp into a civil date. */
function civilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Offset one optional timestamp from the source project's snapshot anchor. */
function relativeOffset(anchor: string, value: Date | null): number | undefined {
  return value === null ? undefined : calendarDaysBetween(anchor, civilDate(value));
}

/** One directed edge used by process graph validation. */
interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/** Add the readiness edge represented by completion timing, if present. */
function timingEdge(stepKey: string, timing: ProcessStepTiming): GraphEdge | null {
  return timing.kind === 'after_step_completion' ? { from: timing.stepKey, to: stepKey } : null;
}

/**
 * Reject cycles across task dependencies, completion timing, and parent-task hierarchy.
 *
 * @param definition - Parsed process definition to inspect.
 * @throws {CycleError} When no topological execution order exists.
 */
export function validateProcessDefinitionGraph(definition: ProcessDefinitionCreateValue): void {
  const parsed = ProcessDefinitionCreate.parse(definition);
  const keys = [
    ...(parsed.project ? [parsed.project.key] : []),
    ...parsed.milestones.map((step) => step.key),
    ...parsed.tasks.map((step) => step.key),
  ];
  const edges: GraphEdge[] = parsed.dependencies.map((edge) => ({
    from: edge.blockingStepKey,
    to: edge.blockedStepKey,
  }));
  for (const step of [
    ...(parsed.project ? [parsed.project] : []),
    ...parsed.milestones,
    ...parsed.tasks,
  ]) {
    const edge = timingEdge(step.key, step.timing);
    if (edge) edges.push(edge);
  }
  for (const step of parsed.tasks) {
    if (step.parentTaskKey) edges.push({ from: step.parentTaskKey, to: step.key });
  }

  const outgoing = new Map(keys.map((key) => [key, [] as string[]]));
  const incoming = new Map(keys.map((key) => [key, 0]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const ready = keys.filter((key) => incoming.get(key) === 0);
  let visited = 0;
  while (ready.length > 0) {
    const key = ready.shift();
    if (key === undefined) break;
    visited += 1;
    for (const dependent of outgoing.get(key) ?? []) {
      const remaining = (incoming.get(dependent) ?? 0) - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }
  if (visited !== keys.length) throw new CycleError('Process graph contains a dependency cycle');
}

/** Require every referenced row to belong to the definition's organization. */
async function validateReferenceOwnership(
  tx: Transaction,
  organizationId: string,
  definition: ProcessDefinitionCreateValue,
): Promise<void> {
  const actorIds = new Set([
    ...(definition.project?.leadId ? [definition.project.leadId] : []),
    ...definition.tasks.flatMap((step) => (step.assigneeId ? [step.assigneeId] : [])),
  ]);
  const teamIds = new Set([
    ...(definition.project?.teamId ? [definition.project.teamId] : []),
    ...definition.tasks.map((step) => step.teamId),
  ]);
  const programIds = new Set(definition.project?.programId ? [definition.project.programId] : []);
  const projectIds = new Set(
    definition.tasks.flatMap((step) => (step.projectId ? [step.projectId] : [])),
  );
  const milestoneIds = new Set(
    definition.tasks.flatMap((step) => (step.milestoneId ? [step.milestoneId] : [])),
  );
  const cycleIds = new Set(
    definition.tasks.flatMap((step) => (step.cycleId ? [step.cycleId] : [])),
  );
  const parentTaskIds = new Set(
    definition.tasks.flatMap((step) => (step.parentTaskId ? [step.parentTaskId] : [])),
  );
  const labelIds = new Set([
    ...(definition.project?.labelIds ?? []),
    ...definition.tasks.flatMap((step) => step.labelIds),
  ]);

  const [actors, teams, programs, projects, milestones, cycles, parentTasks, labels] =
    await Promise.all([
      actorIds.size === 0
        ? []
        : tx
            .select({ id: actor.id })
            .from(actor)
            .where(and(eq(actor.organizationId, organizationId), inArray(actor.id, [...actorIds]))),
      tx
        .select({ id: team.id, workflowStates: team.workflowStates })
        .from(team)
        .where(and(eq(team.organizationId, organizationId), inArray(team.id, [...teamIds]))),
      programIds.size === 0
        ? []
        : tx
            .select({ id: program.id })
            .from(program)
            .where(
              and(eq(program.organizationId, organizationId), inArray(program.id, [...programIds])),
            ),
      projectIds.size === 0
        ? []
        : tx
            .select({ id: project.id })
            .from(project)
            .where(
              and(eq(project.organizationId, organizationId), inArray(project.id, [...projectIds])),
            ),
      milestoneIds.size === 0
        ? []
        : tx
            .select({ id: milestone.id, projectId: milestone.projectId })
            .from(milestone)
            .where(
              and(
                eq(milestone.organizationId, organizationId),
                inArray(milestone.id, [...milestoneIds]),
              ),
            ),
      cycleIds.size === 0
        ? []
        : tx
            .select({ id: cycle.id })
            .from(cycle)
            .where(and(eq(cycle.organizationId, organizationId), inArray(cycle.id, [...cycleIds]))),
      parentTaskIds.size === 0
        ? []
        : tx
            .select({ id: task.id })
            .from(task)
            .where(
              and(eq(task.organizationId, organizationId), inArray(task.id, [...parentTaskIds])),
            ),
      labelIds.size === 0
        ? []
        : tx
            .select({ id: label.id, teamId: label.teamId })
            .from(label)
            .where(and(eq(label.organizationId, organizationId), inArray(label.id, [...labelIds]))),
    ]);
  if (
    actors.length !== actorIds.size ||
    teams.length !== teamIds.size ||
    programs.length !== programIds.size ||
    projects.length !== projectIds.size ||
    milestones.length !== milestoneIds.size ||
    cycles.length !== cycleIds.size ||
    parentTasks.length !== parentTaskIds.size ||
    labels.length !== labelIds.size
  ) {
    throw new NotFoundError('A process reference was not found in this workspace');
  }

  const teamsById = new Map(teams.map((row) => [row.id, row]));
  const milestoneProject = new Map(milestones.map((row) => [row.id, row.projectId]));
  for (const step of definition.tasks) {
    const teamRow = teamsById.get(step.teamId);
    if (!teamRow) throw new NotFoundError('Task team not found');
    const requestedState = step.state
      ? teamRow.workflowStates.find((state) => state.key === step.state)
      : teamRow.workflowStates[0];
    if (step.state && !requestedState) {
      throw new ConflictError(`Task state ${step.state} is not available on its team`);
    }
    if (requestedState?.type === 'completed' || requestedState?.type === 'canceled') {
      throw new ConflictError('A process task must begin in a non-terminal workflow state');
    }
    const allowedLabels = new Set(
      labels
        .filter((value) => value.teamId === null || value.teamId === step.teamId)
        .map((value) => value.id),
    );
    if (step.labelIds.some((id) => !allowedLabels.has(id))) {
      throw new NotFoundError('A task label is not available to its team');
    }
    if (
      step.milestoneId &&
      step.projectId &&
      milestoneProject.get(step.milestoneId) !== step.projectId
    ) {
      throw new ConflictError('A fixed milestone must belong to the fixed project');
    }
  }
  const projectDefinition = definition.project;
  if (projectDefinition) {
    const allowedLabels = new Set(
      labels
        .filter(
          (value) =>
            value.teamId === null ||
            (projectDefinition.teamId !== undefined && value.teamId === projectDefinition.teamId),
        )
        .map((value) => value.id),
    );
    if (projectDefinition.labelIds.some((id) => !allowedLabels.has(id))) {
      throw new NotFoundError('A project label is not available to its team');
    }
  }
}

/** Map a timing union onto normalized process-step columns. */
function timingColumns(
  timing: ProcessStepTiming,
  stepIds: ReadonlyMap<string, string>,
): {
  readonly timingKind: 'on_trigger' | 'relative_to_trigger' | 'after_step_completion';
  readonly offsetDays?: number;
  readonly afterStepId?: string;
} {
  if (timing.kind === 'on_trigger') return { timingKind: 'on_trigger' };
  if (timing.kind === 'relative_to_trigger') {
    return { timingKind: 'relative_to_trigger', offsetDays: timing.offsetDays };
  }
  const afterStepId = stepIds.get(timing.stepKey);
  if (!afterStepId) throw new ConflictError('Completion timing references an unknown step');
  return {
    timingKind: 'after_step_completion',
    offsetDays: timing.offsetDays,
    afterStepId,
  };
}

/** Read a preallocated step id or fail before producing a partial normalized revision. */
function requireStepId(stepIds: ReadonlyMap<string, string>, key: string): string {
  const id = stepIds.get(key);
  if (!id) throw new ConflictError(`Process step ${key} was not allocated`);
  return id;
}

/** Persist one immutable revision and all normalized specification rows. */
async function persistRevision(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly actorId?: string;
    readonly definitionId: string;
    readonly revisionNumber: number;
    readonly definition: ProcessDefinitionCreateValue;
  },
): Promise<PublishedProcessRevision> {
  const { organizationId, actorId, definitionId, revisionNumber, definition } = input;
  const revisionId = genId();
  const allSteps = [
    ...(definition.project
      ? [{ kind: 'project' as const, sort: 0, value: definition.project }]
      : []),
    ...definition.milestones.map((value) => ({
      kind: 'milestone' as const,
      sort: value.sort,
      value,
    })),
    ...definition.tasks.map((value, sort) => ({ kind: 'task' as const, sort, value })),
  ];
  const stepIds = new Map(allSteps.map((step) => [step.value.key, genId()]));

  await tx.insert(processRevision).values({
    id: revisionId,
    organizationId,
    definitionId,
    number: revisionNumber,
    creationMode: definition.creationMode,
    publishedAt: new Date(),
    createdBy: actorId,
  });
  await tx.insert(processStep).values(
    allSteps.map((step) => ({
      id: requireStepId(stepIds, step.value.key),
      organizationId,
      revisionId,
      key: step.value.key,
      kind: step.kind,
      sort: step.sort,
      ...timingColumns(step.value.timing, stepIds),
      createdBy: actorId,
    })),
  );

  const projectSpec = definition.project;
  if (projectSpec) {
    await tx.insert(processProjectSpec).values({
      stepId: requireStepId(stepIds, projectSpec.key),
      organizationId,
      name: projectSpec.name,
      summary: projectSpec.summary,
      description: projectSpec.description,
      leadId: projectSpec.leadId,
      teamId: projectSpec.teamId,
      programId: projectSpec.programId,
      status: projectSpec.status,
      health: projectSpec.health,
      startOffsetDays: projectSpec.startOffsetDays,
      targetOffsetDays: projectSpec.targetOffsetDays,
    });
    if (projectSpec.labelIds.length > 0) {
      await tx.insert(processProjectLabelSpec).values(
        projectSpec.labelIds.map((labelId) => ({
          projectStepId: requireStepId(stepIds, projectSpec.key),
          labelId,
          organizationId,
        })),
      );
    }
  }
  if (definition.milestones.length > 0) {
    await tx.insert(processMilestoneSpec).values(
      definition.milestones.map((step) => ({
        stepId: requireStepId(stepIds, step.key),
        organizationId,
        projectStepId: requireStepId(stepIds, step.projectKey),
        name: step.name,
        description: step.description,
        targetOffsetDays: step.targetOffsetDays,
      })),
    );
  }
  await tx.insert(processTaskSpec).values(
    definition.tasks.map((step) => ({
      stepId: requireStepId(stepIds, step.key),
      organizationId,
      title: step.title,
      description: step.description,
      teamId: step.teamId,
      state: step.state,
      priority: step.priority,
      assigneeId: step.assigneeId,
      projectId: step.projectId,
      projectStepId: step.projectKey ? stepIds.get(step.projectKey) : undefined,
      milestoneId: step.milestoneId,
      milestoneStepId: step.milestoneKey ? stepIds.get(step.milestoneKey) : undefined,
      cycleId: step.cycleId,
      parentTaskId: step.parentTaskId,
      parentTaskStepId: step.parentTaskKey ? stepIds.get(step.parentTaskKey) : undefined,
      estimate: step.estimate,
      estimateMinutes: step.estimateMinutes,
      startOffsetDays: step.startOffsetDays,
      dueOffsetDays: step.dueOffsetDays,
    })),
  );
  const taskLabels = definition.tasks.flatMap((step) =>
    step.labelIds.map((labelId) => ({
      taskStepId: requireStepId(stepIds, step.key),
      labelId,
      organizationId,
    })),
  );
  if (taskLabels.length > 0) await tx.insert(processTaskLabelSpec).values(taskLabels);
  if (definition.dependencies.length > 0) {
    await tx.insert(processDependency).values(
      definition.dependencies.map((edge) => ({
        revisionId,
        blockingStepId: requireStepId(stepIds, edge.blockingStepKey),
        blockedStepId: requireStepId(stepIds, edge.blockedStepKey),
        organizationId,
      })),
    );
  }

  return {
    definitionId,
    revisionId,
    revisionNumber,
    stepIdsByKey: Object.fromEntries(stepIds),
  };
}

/** Create a named process and atomically publish its first immutable revision. */
export async function createPublishedProcessDefinition(
  database: Database,
  command: CreatePublishedProcessDefinitionCommand,
): Promise<PublishedProcessRevision> {
  const definition = ProcessDefinitionCreate.parse(command.definition);
  validateProcessDefinitionGraph(definition);
  return database.transaction(async (tx) => {
    await validateReferenceOwnership(tx, command.organizationId, definition);
    const definitionId = genId();
    await tx.insert(processDefinition).values({
      id: definitionId,
      organizationId: command.organizationId,
      name: definition.name,
      description: definition.description,
      status: 'published',
      createdBy: command.actorId,
    });
    return persistRevision(tx, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      definitionId,
      revisionNumber: 1,
      definition,
    });
  });
}

/** Snapshot one ordinary project's hierarchy, dates, labels, and dependencies as a process. */
export async function createProcessDefinitionFromProject(
  database: Database,
  command: CreateProcessDefinitionFromProjectCommand,
): Promise<PublishedProcessRevision> {
  const source = await database
    .select()
    .from(project)
    .where(
      and(
        eq(project.id, command.input.projectId),
        eq(project.organizationId, command.organizationId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  const sourceProject = source[0];
  if (!sourceProject) throw new NotFoundError('Project not found');

  const [sourceMilestones, sourceTasks, sourceProjectLabels] = await Promise.all([
    database
      .select()
      .from(milestone)
      .where(
        and(
          eq(milestone.organizationId, command.organizationId),
          eq(milestone.projectId, sourceProject.id),
          isNull(milestone.archivedAt),
        ),
      ),
    database
      .select()
      .from(task)
      .where(
        and(
          eq(task.organizationId, command.organizationId),
          eq(task.projectId, sourceProject.id),
          isNull(task.archivedAt),
        ),
      ),
    database
      .select({ labelId: projectLabel.labelId })
      .from(projectLabel)
      .where(eq(projectLabel.projectId, sourceProject.id)),
  ]);
  if (sourceTasks.length === 0) {
    throw new ConflictError('Add at least one task before making this project repeatable');
  }
  const taskIds = sourceTasks.map((value) => value.id);
  const [sourceTaskLabels, sourceDependencies] = await Promise.all([
    database
      .select({ taskId: taskLabel.taskId, labelId: taskLabel.labelId })
      .from(taskLabel)
      .where(inArray(taskLabel.taskId, taskIds)),
    database
      .select()
      .from(taskDependency)
      .where(
        and(
          inArray(taskDependency.blockingTaskId, taskIds),
          inArray(taskDependency.blockedTaskId, taskIds),
        ),
      ),
  ]);

  const datedValues = [
    sourceProject.startDate,
    sourceProject.targetDate,
    ...sourceMilestones.map((value) => value.targetDate),
    ...sourceTasks.flatMap((value) => [value.startDate, value.dueDate]),
  ].filter((value): value is Date => value !== null);
  const anchor = sourceProject.startDate
    ? civilDate(sourceProject.startDate)
    : (datedValues.map(civilDate).sort()[0] ?? civilDate(command.now ?? new Date()));
  const milestoneKeyById = new Map(
    sourceMilestones.map((value, index) => [value.id, `milestone-${index + 1}`]),
  );
  const taskKeyById = new Map(sourceTasks.map((value, index) => [value.id, `task-${index + 1}`]));
  const taskLabelsById = new Map<string, string[]>();
  for (const value of sourceTaskLabels) {
    const current = taskLabelsById.get(value.taskId) ?? [];
    current.push(value.labelId);
    taskLabelsById.set(value.taskId, current);
  }

  const definition: ProcessDefinitionCreateValue = {
    name: command.input.name ?? `${sourceProject.name} series`,
    description: sourceProject.description ?? undefined,
    creationMode: command.input.creationMode,
    project: {
      key: 'project',
      name: `${sourceProject.name} · {date}`,
      summary: sourceProject.summary ?? undefined,
      description: sourceProject.description ?? undefined,
      leadId: sourceProject.leadId ? ActorId.parse(sourceProject.leadId) : undefined,
      teamId: sourceProject.teamId ? TeamId.parse(sourceProject.teamId) : undefined,
      programId: sourceProject.programId ? ProgramId.parse(sourceProject.programId) : undefined,
      status: 'planned',
      startOffsetDays: 0,
      targetOffsetDays: relativeOffset(anchor, sourceProject.targetDate),
      labelIds: sourceProjectLabels.map((value) => LabelId.parse(value.labelId)),
      timing: { kind: 'on_trigger' },
    },
    milestones: sourceMilestones.map((value, index) => ({
      key: milestoneKeyById.get(value.id) ?? `milestone-${index + 1}`,
      projectKey: 'project',
      name: value.name,
      description: value.description ?? undefined,
      sort: value.sort,
      targetOffsetDays: relativeOffset(anchor, value.targetDate),
      timing: { kind: 'on_trigger' },
    })),
    tasks: sourceTasks.map((value, index) => ({
      key: taskKeyById.get(value.id) ?? `task-${index + 1}`,
      title: value.title,
      description: value.description ?? undefined,
      teamId: TeamId.parse(value.teamId),
      priority: value.priority,
      assigneeId: value.assigneeId ? ActorId.parse(value.assigneeId) : undefined,
      projectKey: 'project',
      milestoneKey: value.milestoneId ? milestoneKeyById.get(value.milestoneId) : undefined,
      parentTaskKey: value.parentTaskId ? taskKeyById.get(value.parentTaskId) : undefined,
      estimate: value.estimate ?? undefined,
      estimateMinutes: value.estimateMinutes ?? undefined,
      startOffsetDays: relativeOffset(anchor, value.startDate),
      dueOffsetDays: relativeOffset(anchor, value.dueDate),
      labelIds: (taskLabelsById.get(value.id) ?? []).map((id) => LabelId.parse(id)),
      timing: { kind: 'on_trigger' },
    })),
    dependencies: sourceDependencies.flatMap((value) => {
      const blockingStepKey = taskKeyById.get(value.blockingTaskId);
      const blockedStepKey = taskKeyById.get(value.blockedTaskId);
      return blockingStepKey && blockedStepKey ? [{ blockingStepKey, blockedStepKey }] : [];
    }),
  };
  return createPublishedProcessDefinition(database, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    definition,
  });
}

/** Append and publish a new revision without mutating any prior revision or instance. */
export async function appendPublishedProcessRevision(
  database: Database,
  command: AppendPublishedProcessRevisionCommand,
): Promise<PublishedProcessRevision> {
  const definition = ProcessDefinitionCreate.parse(command.revision);
  validateProcessDefinitionGraph(definition);
  return database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: processDefinition.id, status: processDefinition.status })
      .from(processDefinition)
      .where(
        and(
          eq(processDefinition.id, command.definitionId),
          eq(processDefinition.organizationId, command.organizationId),
        ),
      )
      .for('update')
      .limit(1);
    if (!existing[0]) throw new NotFoundError('Process definition not found');
    if (existing[0].status === 'archived')
      throw new ConflictError('Archived process cannot change');
    await validateReferenceOwnership(tx, command.organizationId, definition);
    const latest = await tx
      .select({ number: processRevision.number })
      .from(processRevision)
      .where(eq(processRevision.definitionId, command.definitionId))
      .orderBy(desc(processRevision.number))
      .limit(1);
    const revisionNumber = (latest[0]?.number ?? 0) + 1;
    await tx
      .update(processDefinition)
      .set({ name: definition.name, description: definition.description, status: 'published' })
      .where(eq(processDefinition.id, command.definitionId));
    return persistRevision(tx, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      definitionId: command.definitionId,
      revisionNumber,
      definition,
    });
  });
}

/** Convert normalized timing columns back to the public discriminated timing union. */
function timingFromRow(
  row: typeof processStep.$inferSelect,
  keysByStepId: ReadonlyMap<string, string>,
): ProcessStepTiming {
  if (row.timingKind === 'on_trigger') return { kind: 'on_trigger' };
  if (row.timingKind === 'relative_to_trigger') {
    return { kind: 'relative_to_trigger', offsetDays: row.offsetDays ?? 0 };
  }
  const stepKey = row.afterStepId ? keysByStepId.get(row.afterStepId) : undefined;
  if (!stepKey) throw new ConflictError('Published process timing is incomplete');
  return {
    kind: 'after_step_completion',
    stepKey,
    offsetDays: row.offsetDays ?? 0,
  };
}

/** Load one org-scoped process and reconstruct its latest immutable revision. */
export async function loadProcessDefinitionDetail(
  database: Database,
  organizationId: string,
  definitionId: string,
): Promise<z.input<typeof ProcessDefinitionDetailOut>> {
  const definitions = await database
    .select()
    .from(processDefinition)
    .where(
      and(
        eq(processDefinition.id, definitionId),
        eq(processDefinition.organizationId, organizationId),
        isNull(processDefinition.archivedAt),
      ),
    )
    .limit(1);
  const definition = definitions[0];
  if (!definition) throw new NotFoundError('Process definition not found');
  const revisions = await database
    .select()
    .from(processRevision)
    .where(
      and(
        eq(processRevision.definitionId, definitionId),
        eq(processRevision.organizationId, organizationId),
      ),
    )
    .orderBy(desc(processRevision.number))
    .limit(1);
  const revision = revisions[0];
  if (!revision) throw new ConflictError('Process definition has no published revision');
  const steps = await database
    .select()
    .from(processStep)
    .where(eq(processStep.revisionId, revision.id))
    .orderBy(processStep.sort, processStep.createdAt);
  const stepIds = steps.map((step) => step.id);
  const keysByStepId = new Map(steps.map((step) => [step.id, step.key]));
  const [projectSpecs, milestoneSpecs, taskSpecs, taskLabels, projectLabels, dependencies] =
    stepIds.length === 0
      ? [[], [], [], [], [], []]
      : await Promise.all([
          database
            .select()
            .from(processProjectSpec)
            .where(inArray(processProjectSpec.stepId, stepIds)),
          database
            .select()
            .from(processMilestoneSpec)
            .where(inArray(processMilestoneSpec.stepId, stepIds)),
          database.select().from(processTaskSpec).where(inArray(processTaskSpec.stepId, stepIds)),
          database
            .select()
            .from(processTaskLabelSpec)
            .where(inArray(processTaskLabelSpec.taskStepId, stepIds)),
          database
            .select()
            .from(processProjectLabelSpec)
            .where(inArray(processProjectLabelSpec.projectStepId, stepIds)),
          database
            .select()
            .from(processDependency)
            .where(eq(processDependency.revisionId, revision.id)),
        ]);
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const taskLabelsByStep = new Map<string, string[]>();
  for (const value of taskLabels) {
    const current = taskLabelsByStep.get(value.taskStepId) ?? [];
    current.push(value.labelId);
    taskLabelsByStep.set(value.taskStepId, current);
  }
  const projectLabelsByStep = new Map<string, string[]>();
  for (const value of projectLabels) {
    const current = projectLabelsByStep.get(value.projectStepId) ?? [];
    current.push(value.labelId);
    projectLabelsByStep.set(value.projectStepId, current);
  }

  const projectSpec = projectSpecs[0];
  const projectStep = projectSpec ? stepsById.get(projectSpec.stepId) : undefined;
  const projectOut =
    projectSpec && projectStep
      ? {
          key: projectStep.key,
          name: projectSpec.name,
          ...(projectSpec.summary === null ? {} : { summary: projectSpec.summary }),
          ...(projectSpec.description === null ? {} : { description: projectSpec.description }),
          ...(projectSpec.leadId === null ? {} : { leadId: projectSpec.leadId }),
          ...(projectSpec.teamId === null ? {} : { teamId: projectSpec.teamId }),
          ...(projectSpec.programId === null ? {} : { programId: projectSpec.programId }),
          status: projectSpec.status,
          ...(projectSpec.health === null ? {} : { health: projectSpec.health }),
          ...(projectSpec.startOffsetDays === null
            ? {}
            : { startOffsetDays: projectSpec.startOffsetDays }),
          ...(projectSpec.targetOffsetDays === null
            ? {}
            : { targetOffsetDays: projectSpec.targetOffsetDays }),
          labelIds: projectLabelsByStep.get(projectSpec.stepId) ?? [],
          timing: timingFromRow(projectStep, keysByStepId),
        }
      : undefined;
  const milestonesOut = milestoneSpecs.map((spec) => {
    const step = stepsById.get(spec.stepId);
    const projectKey = keysByStepId.get(spec.projectStepId);
    if (!step || !projectKey)
      throw new ConflictError('Published milestone specification is incomplete');
    return {
      key: step.key,
      projectKey,
      name: spec.name,
      ...(spec.description === null ? {} : { description: spec.description }),
      sort: step.sort,
      ...(spec.targetOffsetDays === null ? {} : { targetOffsetDays: spec.targetOffsetDays }),
      timing: timingFromRow(step, keysByStepId),
    };
  });
  const tasksOut = taskSpecs.map((spec) => {
    const step = stepsById.get(spec.stepId);
    if (!step) throw new ConflictError('Published task specification is incomplete');
    return {
      key: step.key,
      title: spec.title,
      ...(spec.description === null ? {} : { description: spec.description }),
      teamId: spec.teamId,
      ...(spec.state === null ? {} : { state: spec.state }),
      priority: spec.priority,
      ...(spec.assigneeId === null ? {} : { assigneeId: spec.assigneeId }),
      ...(spec.projectId === null ? {} : { projectId: spec.projectId }),
      ...(spec.projectStepId === null ? {} : { projectKey: keysByStepId.get(spec.projectStepId) }),
      ...(spec.milestoneId === null ? {} : { milestoneId: spec.milestoneId }),
      ...(spec.milestoneStepId === null
        ? {}
        : { milestoneKey: keysByStepId.get(spec.milestoneStepId) }),
      ...(spec.cycleId === null ? {} : { cycleId: spec.cycleId }),
      ...(spec.parentTaskId === null ? {} : { parentTaskId: spec.parentTaskId }),
      ...(spec.parentTaskStepId === null
        ? {}
        : { parentTaskKey: keysByStepId.get(spec.parentTaskStepId) }),
      ...(spec.estimate === null ? {} : { estimate: spec.estimate }),
      ...(spec.estimateMinutes === null ? {} : { estimateMinutes: spec.estimateMinutes }),
      ...(spec.startOffsetDays === null ? {} : { startOffsetDays: spec.startOffsetDays }),
      ...(spec.dueOffsetDays === null ? {} : { dueOffsetDays: spec.dueOffsetDays }),
      labelIds: taskLabelsByStep.get(spec.stepId) ?? [],
      timing: timingFromRow(step, keysByStepId),
    };
  });
  const dependenciesOut = dependencies.map((edge) => {
    const blockingStepKey = keysByStepId.get(edge.blockingStepId);
    const blockedStepKey = keysByStepId.get(edge.blockedStepId);
    if (!blockingStepKey || !blockedStepKey) {
      throw new ConflictError('Published process dependency is incomplete');
    }
    return { blockingStepKey, blockedStepKey };
  });

  return ProcessDefinitionDetailOut.parse({
    id: definition.id,
    organizationId: definition.organizationId,
    name: definition.name,
    description: definition.description,
    status: definition.status,
    latestRevisionNumber: revision.number,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
    revision: {
      id: revision.id,
      definitionId: definition.id,
      number: revision.number,
      creationMode: revision.creationMode,
      ...(projectOut === undefined ? {} : { project: projectOut }),
      milestones: milestonesOut,
      tasks: tasksOut,
      dependencies: dependenciesOut,
      publishedAt: revision.publishedAt?.toISOString() ?? null,
      createdAt: revision.createdAt.toISOString(),
    },
  });
}

/** List active org-scoped process definitions as compact latest-revision summaries. */
export async function listProcessDefinitions(
  database: Database,
  organizationId: string,
): Promise<z.input<typeof ProcessDefinitionSummaryOut>[]> {
  const definitions = await database
    .select()
    .from(processDefinition)
    .where(
      and(
        eq(processDefinition.organizationId, organizationId),
        isNull(processDefinition.archivedAt),
        ne(processDefinition.status, 'archived'),
      ),
    )
    .orderBy(desc(processDefinition.updatedAt));
  return Promise.all(
    definitions.map(async (definition) => {
      const latest = await database
        .select({ number: processRevision.number })
        .from(processRevision)
        .where(eq(processRevision.definitionId, definition.id))
        .orderBy(desc(processRevision.number))
        .limit(1);
      const number = latest[0]?.number;
      if (!number) throw new ConflictError('Process definition has no published revision');
      return ProcessDefinitionSummaryOut.parse({
        id: definition.id,
        organizationId: definition.organizationId,
        name: definition.name,
        description: definition.description,
        status: definition.status,
        latestRevisionNumber: number,
        createdAt: definition.createdAt.toISOString(),
        updatedAt: definition.updatedAt.toISOString(),
      });
    }),
  );
}

/** Update mutable definition metadata without rewriting executable revision history. */
export async function updateProcessDefinitionMetadata(
  database: Database,
  command: {
    readonly organizationId: string;
    readonly definitionId: string;
    readonly patch: z.input<typeof ProcessDefinitionUpdate>;
  },
): Promise<z.input<typeof ProcessDefinitionDetailOut>> {
  const patch = ProcessDefinitionUpdate.parse(command.patch);
  const updated = await database
    .update(processDefinition)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
    })
    .where(
      and(
        eq(processDefinition.id, command.definitionId),
        eq(processDefinition.organizationId, command.organizationId),
        isNull(processDefinition.archivedAt),
      ),
    )
    .returning({ id: processDefinition.id });
  if (!updated[0]) throw new NotFoundError('Process definition not found');
  return loadProcessDefinitionDetail(database, command.organizationId, command.definitionId);
}

/** Archive a process definition and end active series without deleting historical work. */
export async function archiveProcessDefinition(
  database: Database,
  organizationId: string,
  definitionId: string,
): Promise<z.input<typeof ProcessDefinitionSummaryOut>> {
  const before = await loadProcessDefinitionDetail(database, organizationId, definitionId);
  const now = new Date();
  await database
    .update(processDefinition)
    .set({ status: 'archived', archivedAt: now })
    .where(
      and(
        eq(processDefinition.id, definitionId),
        eq(processDefinition.organizationId, organizationId),
      ),
    );
  await database
    .update(recurrenceSeries)
    .set({ status: 'ended', endedAt: now })
    .where(
      and(
        eq(recurrenceSeries.definitionId, definitionId),
        eq(recurrenceSeries.organizationId, organizationId),
        ne(recurrenceSeries.status, 'ended'),
      ),
    );
  return ProcessDefinitionSummaryOut.parse({
    id: before.id,
    organizationId: before.organizationId,
    name: before.name,
    description: before.description,
    status: 'archived',
    latestRevisionNumber: before.latestRevisionNumber,
    createdAt: before.createdAt,
    updatedAt: now.toISOString(),
  });
}
