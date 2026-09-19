/**
 * `@docket/api` — what a process definition has to satisfy before it can be published.
 *
 * @remarks
 * A published revision is immutable and every materialized instance keeps its id, so a definition
 * that is wrong is wrong forever: the only repair is publishing a new revision and leaving the
 * broken one behind. Both checks here therefore run before anything is written.
 *
 * The graph check rejects a definition no execution order exists for. The ownership check rejects
 * one that names a row from another workspace, a state its team does not have, or a label its team
 * cannot apply — each of which would fail later, once per occurrence, somewhere far from the person
 * who authored it.
 */
import { actor, cycle, label, milestone, program, project, task, team } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import {
  ProcessDefinitionCreate,
  type ProcessDefinitionCreate as ProcessDefinitionCreateValue,
  type ProcessStepTiming,
} from '../../contracts/recurrence';
import { ConflictError, CycleError, NotFoundError } from '../../error';

import type { ProcessTransaction } from './process-contracts';

interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/** Add the readiness edge represented by completion timing, if present. */
function timingEdge(stepKey: string, timing: ProcessStepTiming): GraphEdge | null {
  return timing.kind === 'after_step_completion' ? { from: timing.stepKey, to: stepKey } : null;
}

/**
 * Every readiness edge a definition declares, from dependencies, timing, and hierarchy.
 *
 * @param parsed - The parsed definition.
 * @returns The edges, each pointing from the step that must come first.
 */
function definitionEdges(parsed: ProcessDefinitionCreateValue): readonly GraphEdge[] {
  const edges: GraphEdge[] = parsed.dependencies.map((edge) => ({
    from: edge.blockingStepKey,
    to: edge.blockedStepKey,
  }));
  const steps = [
    ...(parsed.project ? [parsed.project] : []),
    ...parsed.milestones,
    ...parsed.tasks,
  ];
  for (const step of steps) {
    const edge = timingEdge(step.key, step.timing);
    if (edge) edges.push(edge);
  }
  for (const step of parsed.tasks) {
    if (step.parentTaskKey) edges.push({ from: step.parentTaskKey, to: step.key });
  }
  return edges;
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

  const outgoing = new Map(keys.map((key) => [key, [] as string[]]));
  const incoming = new Map(keys.map((key) => [key, 0]));
  for (const edge of definitionEdges(parsed)) {
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

/** Every id a definition names, grouped by the table it has to exist in. */
interface ReferencedIds {
  readonly actorIds: ReadonlySet<string>;
  readonly teamIds: ReadonlySet<string>;
  readonly programIds: ReadonlySet<string>;
  readonly projectIds: ReadonlySet<string>;
  readonly milestoneIds: ReadonlySet<string>;
  readonly cycleIds: ReadonlySet<string>;
  readonly parentTaskIds: ReadonlySet<string>;
  readonly labelIds: ReadonlySet<string>;
}

/**
 * Collect every row id a definition names.
 *
 * @param definition - The definition being published.
 * @returns The ids, grouped by table.
 */
function referencedIds(definition: ProcessDefinitionCreateValue): ReferencedIds {
  return {
    actorIds: new Set([
      ...(definition.project?.leadId ? [definition.project.leadId] : []),
      ...definition.tasks.flatMap((step) => (step.assigneeId ? [step.assigneeId] : [])),
    ]),
    teamIds: new Set([
      ...(definition.project?.teamId ? [definition.project.teamId] : []),
      ...definition.tasks.map((step) => step.teamId),
    ]),
    programIds: new Set(definition.project?.programId ? [definition.project.programId] : []),
    projectIds: new Set(
      definition.tasks.flatMap((step) => (step.projectId ? [step.projectId] : [])),
    ),
    milestoneIds: new Set(
      definition.tasks.flatMap((step) => (step.milestoneId ? [step.milestoneId] : [])),
    ),
    cycleIds: new Set(definition.tasks.flatMap((step) => (step.cycleId ? [step.cycleId] : []))),
    parentTaskIds: new Set(
      definition.tasks.flatMap((step) => (step.parentTaskId ? [step.parentTaskId] : [])),
    ),
    labelIds: new Set([
      ...(definition.project?.labelIds ?? []),
      ...definition.tasks.flatMap((step) => step.labelIds),
    ]),
  };
}

/** The referenced rows that actually exist in the definition's workspace. */
interface ResolvedReferences {
  readonly teams: readonly {
    id: string;
    workflowStates: readonly { key: string; type: string }[];
  }[];
  readonly milestones: readonly { id: string; projectId: string }[];
  readonly labels: readonly { id: string; teamId: string | null }[];
}

/**
 * Load every referenced row, refusing a definition that names one this workspace does not have.
 *
 * @param tx - The open transaction.
 * @param organizationId - The workspace publishing the definition.
 * @param ids - The ids the definition names.
 * @returns The rows the later checks read.
 * @throws {NotFoundError} When any referenced row is missing.
 */
/**
 * Read one referenced table, or nothing when the definition names none of its rows.
 *
 * @param ids - The ids the definition names in this table.
 * @param read - The query to run when it names any.
 * @returns The rows, or an empty list.
 */
async function readReferenced<TRow>(
  ids: ReadonlySet<string>,
  read: (list: string[]) => Promise<TRow[]>,
): Promise<TRow[]> {
  return ids.size === 0 ? [] : read([...ids]);
}

async function resolveReferences(
  tx: ProcessTransaction,
  organizationId: string,
  ids: ReferencedIds,
): Promise<ResolvedReferences> {
  const [actors, teams, programs, projects, milestones, cycles, parentTasks, labels] =
    await Promise.all([
      readReferenced(ids.actorIds, (list) =>
        tx
          .select({ id: actor.id })
          .from(actor)
          .where(and(eq(actor.organizationId, organizationId), inArray(actor.id, list))),
      ),
      tx
        .select({ id: team.id, workflowStates: team.workflowStates })
        .from(team)
        .where(and(eq(team.organizationId, organizationId), inArray(team.id, [...ids.teamIds]))),
      readReferenced(ids.programIds, (list) =>
        tx
          .select({ id: program.id })
          .from(program)
          .where(and(eq(program.organizationId, organizationId), inArray(program.id, list))),
      ),
      readReferenced(ids.projectIds, (list) =>
        tx
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.organizationId, organizationId), inArray(project.id, list))),
      ),
      readReferenced(ids.milestoneIds, (list) =>
        tx
          .select({ id: milestone.id, projectId: milestone.projectId })
          .from(milestone)
          .where(and(eq(milestone.organizationId, organizationId), inArray(milestone.id, list))),
      ),
      readReferenced(ids.cycleIds, (list) =>
        tx
          .select({ id: cycle.id })
          .from(cycle)
          .where(and(eq(cycle.organizationId, organizationId), inArray(cycle.id, list))),
      ),
      readReferenced(ids.parentTaskIds, (list) =>
        tx
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.organizationId, organizationId), inArray(task.id, list))),
      ),
      readReferenced(ids.labelIds, (list) =>
        tx
          .select({ id: label.id, teamId: label.teamId })
          .from(label)
          .where(and(eq(label.organizationId, organizationId), inArray(label.id, list))),
      ),
    ]);
  const complete =
    actors.length === ids.actorIds.size &&
    teams.length === ids.teamIds.size &&
    programs.length === ids.programIds.size &&
    projects.length === ids.projectIds.size &&
    milestones.length === ids.milestoneIds.size &&
    cycles.length === ids.cycleIds.size &&
    parentTasks.length === ids.parentTaskIds.size &&
    labels.length === ids.labelIds.size;
  if (!complete) throw new NotFoundError('A process reference was not found in this workspace');
  return { teams, milestones, labels };
}

/**
 * Check each task step against the team it lands on.
 *
 * @remarks
 * A task must start somewhere it can move on from, and may only carry labels its own team can
 * apply — a team-scoped label on another team's task would be invisible to everyone who works it.
 *
 * @param definition - The definition being published.
 * @param resolved - The referenced rows that exist.
 * @throws {NotFoundError} When a label is not available to the step's team.
 * @throws {ConflictError} When a state is unavailable, terminal, or a container disagrees.
 */
function validateTaskSteps(
  definition: ProcessDefinitionCreateValue,
  resolved: ResolvedReferences,
): void {
  const teamsById = new Map(resolved.teams.map((row) => [row.id, row]));
  const milestoneProject = new Map(resolved.milestones.map((row) => [row.id, row.projectId]));
  for (const step of definition.tasks) {
    const teamRow = teamsById.get(step.teamId);
    if (!teamRow) throw new NotFoundError('Task team not found');
    assertStartableState(teamRow.workflowStates, step.state);
    assertLabelsAllowed(resolved.labels, step.teamId, step.labelIds, 'A task label');
    if (
      step.milestoneId &&
      step.projectId &&
      milestoneProject.get(step.milestoneId) !== step.projectId
    ) {
      throw new ConflictError('A fixed milestone must belong to the fixed project');
    }
  }
}

/**
 * Refuse a task step that starts in a state its team cannot move on from.
 *
 * @param workflowStates - The team's configured states.
 * @param requested - The state key the step named, when it named one.
 * @throws {ConflictError} When the state is unavailable or already terminal.
 */
function assertStartableState(
  workflowStates: readonly { key: string; type: string }[],
  requested: string | undefined,
): void {
  const state = requested
    ? workflowStates.find((candidate) => candidate.key === requested)
    : workflowStates[0];
  if (requested && !state) {
    throw new ConflictError(`Task state ${requested} is not available on its team`);
  }
  if (state?.type === 'completed' || state?.type === 'canceled') {
    throw new ConflictError('A process task must begin in a non-terminal workflow state');
  }
}

/**
 * Refuse a step that carries a label its own team cannot apply.
 *
 * @param labels - Every referenced label, with the team that scopes it.
 * @param teamId - The team this step lands on, when it names one.
 * @param labelIds - The labels the step carries.
 * @param subject - The application-owned name for the step, used in the refusal.
 * @throws {NotFoundError} When any label is scoped to another team.
 */
function assertLabelsAllowed(
  labels: readonly { id: string; teamId: string | null }[],
  teamId: string | undefined,
  labelIds: readonly string[],
  subject: string,
): void {
  const allowed = new Set(
    labels
      .filter((value) => value.teamId === null || (teamId !== undefined && value.teamId === teamId))
      .map((value) => value.id),
  );
  if (labelIds.some((id) => !allowed.has(id))) {
    throw new NotFoundError(`${subject} is not available to its team`);
  }
}

/**
 * Check the project step's labels against the team it lands on.
 *
 * @param definition - The definition being published.
 * @param resolved - The referenced rows that exist.
 * @throws {NotFoundError} When a label is not available to the project's team.
 */
function validateProjectStep(
  definition: ProcessDefinitionCreateValue,
  resolved: ResolvedReferences,
): void {
  const projectDefinition = definition.project;
  if (!projectDefinition) return;
  assertLabelsAllowed(
    resolved.labels,
    projectDefinition.teamId,
    projectDefinition.labelIds,
    'A project label',
  );
}

/**
 * Require every referenced row to belong to the definition's organization.
 *
 * @param tx - The open transaction.
 * @param organizationId - The workspace publishing the definition.
 * @param definition - The definition being published.
 */
export async function validateReferenceOwnership(
  tx: ProcessTransaction,
  organizationId: string,
  definition: ProcessDefinitionCreateValue,
): Promise<void> {
  const resolved = await resolveReferences(tx, organizationId, referencedIds(definition));
  validateTaskSteps(definition, resolved);
  validateProjectStep(definition, resolved);
}
