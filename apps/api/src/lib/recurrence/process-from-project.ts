/**
 * `@docket/api` — snapshotting a live project into a reusable process definition.
 *
 * @remarks
 * "Make this repeatable" is authoring by example: the project a person already built becomes the
 * template, so they never retype it. The translation is mostly one of *anchoring* — a snapshot
 * stores every date as a signed offset from the project's own start, so running the process in
 * March produces March's dates rather than the original project's.
 *
 * References are rewritten to authored step keys rather than row ids, because the generated work
 * has to point at its own generated containers, not at the project this was copied from.
 */
import {
  milestone,
  project,
  projectLabel,
  task,
  taskDependency,
  taskLabel,
  type Database,
} from '@docket/db';
import { ActorId, TeamId } from '@docket/identity-access/ids';
import { LabelId, ProgramId } from '@docket/work/ids';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { calendarDaysBetween } from '@docket/planning/calendar-date';
import type { ProcessDefinitionCreate as ProcessDefinitionCreateValue } from '../../contracts/recurrence';
import { ConflictError, NotFoundError } from '../../error';

import {
  createPublishedProcessDefinition,
  type CreateProcessDefinitionFromProjectCommand,
  type PublishedProcessRevision,
} from './process-definition';

/** The civil date a timestamp falls on, in UTC. */
function civilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A stored date as a signed day offset from the snapshot's anchor, or nothing when unset. */
function relativeOffset(anchor: string, value: Date | null): number | undefined {
  return value === null ? undefined : calendarDaysBetween(anchor, civilDate(value));
}

export async function createProcessDefinitionFromProject(
  database: Database,
  command: CreateProcessDefinitionFromProjectCommand,
): Promise<PublishedProcessRevision> {
  const snapshot = await loadProjectSnapshot(database, command);
  return createPublishedProcessDefinition(database, {
    organizationId: command.organizationId,
    actorId: command.actorId,
    definition: snapshotDefinition(command, snapshot),
  });
}

/** The live project a snapshot is taken from, with everything filed under it. */
interface ProjectSnapshot {
  readonly sourceProject: typeof project.$inferSelect;
  readonly sourceMilestones: readonly (typeof milestone.$inferSelect)[];
  readonly sourceTasks: readonly (typeof task.$inferSelect)[];
  readonly sourceProjectLabels: readonly { labelId: string }[];
  readonly sourceTaskLabels: readonly { taskId: string; labelId: string }[];
  readonly sourceDependencies: readonly (typeof taskDependency.$inferSelect)[];
}

/**
 * Read the live project and everything filed under it.
 *
 * @param database - The database handle.
 * @param command - The snapshot request.
 * @returns The rows the definition is built from.
 * @throws {NotFoundError} When the project is archived or belongs to another workspace.
 * @throws {ConflictError} When it has no tasks, so there would be nothing to repeat.
 */
async function loadProjectSnapshot(
  database: Database,
  command: CreateProcessDefinitionFromProjectCommand,
): Promise<ProjectSnapshot> {
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
  return {
    sourceProject,
    sourceMilestones,
    sourceTasks,
    sourceProjectLabels,
    sourceTaskLabels,
    sourceDependencies,
  };
}

/**
 * The date every offset in the snapshot is measured from.
 *
 * @remarks
 * The project's own start when it has one, otherwise the earliest date anything under it carries,
 * otherwise today — so a project with no dates at all still snapshots, with every offset zero.
 *
 * @param command - The snapshot request, for its clock.
 * @param snapshot - The rows being snapshotted.
 * @returns The anchor date.
 */
function snapshotAnchor(
  command: CreateProcessDefinitionFromProjectCommand,
  snapshot: ProjectSnapshot,
): string {
  const { sourceProject, sourceMilestones, sourceTasks } = snapshot;
  if (sourceProject.startDate) return civilDate(sourceProject.startDate);
  const dated = [
    sourceProject.targetDate,
    ...sourceMilestones.map((value) => value.targetDate),
    ...sourceTasks.flatMap((value) => [value.startDate, value.dueDate]),
  ].filter((value): value is Date => value !== null);
  return dated.map(civilDate).sort()[0] ?? civilDate(command.now ?? new Date());
}

/**
 * Translate the snapshotted rows into the definition document they publish as.
 *
 * @param command - The snapshot request.
 * @param snapshot - The rows being snapshotted.
 * @returns The definition to publish.
 */
function snapshotDefinition(
  command: CreateProcessDefinitionFromProjectCommand,
  snapshot: ProjectSnapshot,
): ProcessDefinitionCreateValue {
  const {
    sourceProject,
    sourceMilestones,
    sourceTasks,
    sourceProjectLabels,
    sourceTaskLabels,
    sourceDependencies,
  } = snapshot;
  const anchor = snapshotAnchor(command, snapshot);
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

  return {
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
}
