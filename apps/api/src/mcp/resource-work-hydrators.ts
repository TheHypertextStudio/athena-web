import {
  cycle,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  milestone,
  program,
  project,
  task,
  taskDependency,
  update,
} from '@docket/db';
import { defaultCycleName } from '@docket/work/cycle-contract';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { ViewableTaskParts } from '../routes/task-helpers';
import { originOf } from './change-set';
import { stateOptionsOf, stateTypeOf, teamWorkflows } from './workflow-states';

/** The canonical predicate for task references included in a hydrated MCP resource. */
export type TaskViewFilter = (task: ViewableTaskParts) => boolean;

/** A lightweight task ref shared by hydrated DTOs (dependencies, subtasks). */
export function taskRef(t: {
  id: string;
  title: string;
  state: string;
  projectId: string | null;
}): { id: string; title: string; state: string; projectId: string | null } {
  return { id: t.id, title: t.title, state: t.state, projectId: t.projectId };
}

/** The latest status update for a subject (drives the subject's current health). */
export async function latestUpdateFor(
  orgId: string,
  subjectType: 'project' | 'program' | 'initiative',
  subjectId: string,
): Promise<unknown> {
  const rows = await db
    .select({
      id: update.id,
      health: update.health,
      body: update.body,
      createdAt: update.createdAt,
    })
    .from(update)
    .where(
      and(
        eq(update.organizationId, orgId),
        eq(update.subjectType, subjectType),
        eq(update.subjectId, subjectId),
      ),
    )
    .orderBy(desc(update.createdAt))
    .limit(1);
  const u = rows[0];
  if (!u) return null;
  return { id: u.id, health: u.health, body: u.body, createdAt: u.createdAt.toISOString() };
}

/** Full task: state, refs, dependencies (blocking + blocked-by), subtasks. */
export async function hydrateTask(
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const t = rows[0];
  if (!t) throw new NotFoundError();

  const cols = {
    id: task.id,
    title: task.title,
    state: task.state,
    teamId: task.teamId,
    projectId: task.projectId,
    programId: task.programId,
    visibility: task.visibility,
  };
  const [blocking, blockedBy, subtasks, origin, workflows] = await Promise.all([
    db
      .select(cols)
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
      .where(and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.organizationId, orgId))),
    db
      .select(cols)
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
      .where(and(eq(taskDependency.blockedTaskId, id), eq(taskDependency.organizationId, orgId))),
    db
      .select(cols)
      .from(task)
      .where(
        and(eq(task.parentTaskId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
      ),
    originOf('task', id),
    // Concurrent with the dependency reads rather than after them: the state type depends only on
    // the task row already in hand, so serialising it would add a round trip for nothing.
    teamWorkflows(orgId, [t.teamId]),
  ]);

  return {
    id: t.id,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    // The canonical category `state` maps onto. Per-team state keys are renameable, so this is
    // what a status glyph and any cross-team comparison must key off.
    stateType: stateTypeOf(workflows, t.teamId, t.state) ?? null,
    // Where this task may go next, in board order. Published because a caller cannot derive it:
    // the keys are this team's, so anything offering a state picker — a widget, or a model
    // choosing an argument for `update` — would otherwise have to guess at names like `shipped`.
    stateOptions: stateOptionsOf(workflows, t.teamId).map((state) => ({
      key: state.key,
      name: state.name,
      type: state.type,
    })),
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    milestoneId: t.milestoneId,
    cycleId: t.cycleId,
    parentTaskId: t.parentTaskId,
    estimate: t.estimate,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    // Authorship, which is a different axis from `provenance` above: that says whether the row is
    // mirrored from an external system, this says which tool and conversation made it. Null for
    // anything created before change sets existed, or through the web app.
    origin: origin
      ? {
          tool: origin.origin.tool,
          client: origin.origin.client ?? null,
          sessionId: origin.origin.sessionId ?? null,
          actorId: origin.actorId,
          at: origin.at.toISOString(),
        }
      : null,
    blocking: blocking.filter(canViewTask).map(taskRef),
    blockedBy: blockedBy.filter(canViewTask).map(taskRef),
    subtasks: subtasks.filter(canViewTask).map(taskRef),
    createdAt: t.createdAt.toISOString(),
  };
}

/** Project: overview, health, milestones, linked initiatives, latest update. */
export async function hydrateProject(
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  const rows = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.organizationId, orgId), isNull(project.archivedAt)))
    .limit(1);
  const p = rows[0];
  if (!p) throw new NotFoundError();

  const [milestones, taskRows, initiativeRows, latestUpdate] = await Promise.all([
    db
      .select({ id: milestone.id, name: milestone.name, targetDate: milestone.targetDate })
      .from(milestone)
      .where(eq(milestone.projectId, id))
      .orderBy(asc(milestone.sort)),
    db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        teamId: task.teamId,
        projectId: task.projectId,
        programId: task.programId,
        visibility: task.visibility,
      })
      .from(task)
      .where(and(eq(task.projectId, id), isNull(task.archivedAt)))
      .orderBy(asc(task.dueDate), asc(task.createdAt)),
    db
      .select({ id: initiative.id, name: initiative.name })
      .from(initiativeProject)
      .innerJoin(initiative, eq(initiativeProject.initiativeId, initiative.id))
      .where(and(eq(initiativeProject.projectId, id), eq(initiativeProject.organizationId, orgId))),
    latestUpdateFor(orgId, 'project', id),
  ]);

  const visibleTasks = taskRows.filter(canViewTask);

  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    description: p.description,
    status: p.status,
    health: p.health,
    leadId: p.leadId,
    programId: p.programId,
    teamId: p.teamId,
    startDate: p.startDate?.toISOString() ?? null,
    startDateResolution: p.startDateResolution,
    startDateFiscalYearStartMonth: p.startDateFiscalYearStartMonth,
    targetDate: p.targetDate?.toISOString() ?? null,
    targetDateResolution: p.targetDateResolution,
    targetDateFiscalYearStartMonth: p.targetDateFiscalYearStartMonth,
    taskCount: visibleTasks.length,
    tasks: visibleTasks.slice(0, 4).map(taskRef),
    milestones: milestones.map((m) => ({
      id: m.id,
      name: m.name,
      targetDate: m.targetDate?.toISOString() ?? null,
    })),
    initiatives: initiativeRows,
    latestUpdate,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Program: health, child rollup (projects + tasks), linked initiatives. No percent bar. */
export async function hydrateProgram(
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  const rows = await db
    .select()
    .from(program)
    .where(and(eq(program.id, id), eq(program.organizationId, orgId)))
    .limit(1);
  const p = rows[0];
  if (!p) throw new NotFoundError();

  const projectRows = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(
      and(eq(project.programId, id), eq(project.organizationId, orgId), isNull(project.archivedAt)),
    );
  const projectIds = projectRows.map((r) => r.id);
  const programTaskScope =
    projectIds.length > 0
      ? or(inArray(task.projectId, projectIds), and(isNull(task.projectId), eq(task.programId, id)))
      : and(isNull(task.projectId), eq(task.programId, id));

  const [taskRows, initiativeRows, latestUpdate] = await Promise.all([
    db
      .select({
        id: task.id,
        teamId: task.teamId,
        projectId: task.projectId,
        programId: task.programId,
        visibility: task.visibility,
      })
      .from(task)
      .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt), programTaskScope)),
    db
      .select({ id: initiative.id, name: initiative.name })
      .from(initiativeProgram)
      .innerJoin(initiative, eq(initiativeProgram.initiativeId, initiative.id))
      .where(and(eq(initiativeProgram.programId, id), eq(initiativeProgram.organizationId, orgId))),
    latestUpdateFor(orgId, 'program', id),
  ]);

  const visibleTasks = taskRows.filter(canViewTask);

  return {
    id: p.id,
    name: p.name,
    summary: p.summary,
    description: p.description,
    status: p.status,
    health: p.health,
    ownerId: p.ownerId,
    projects: projectRows,
    rollup: { projects: projectRows.length, tasks: visibleTasks.length },
    initiatives: initiativeRows,
    latestUpdate,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Initiative: associated projects/programs (a theme holds no work of its own). */
export async function hydrateInitiative(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(initiative)
    .where(and(eq(initiative.id, id), eq(initiative.organizationId, orgId)))
    .limit(1);
  const i = rows[0];
  if (!i) throw new NotFoundError();

  const [projectRows, programRows] = await Promise.all([
    db
      .select({
        id: project.id,
        name: project.name,
        health: project.health,
        status: project.status,
      })
      .from(initiativeProject)
      .innerJoin(project, eq(initiativeProject.projectId, project.id))
      .where(
        and(
          eq(initiativeProject.initiativeId, id),
          eq(initiativeProject.organizationId, orgId),
          isNull(project.archivedAt),
        ),
      ),
    db
      .select({ id: program.id, name: program.name, health: program.health })
      .from(initiativeProgram)
      .innerJoin(program, eq(initiativeProgram.programId, program.id))
      .where(
        and(eq(initiativeProgram.initiativeId, id), eq(initiativeProgram.organizationId, orgId)),
      ),
  ]);

  return {
    id: i.id,
    name: i.name,
    summary: i.summary,
    description: i.description,
    status: i.status,
    health: i.health,
    ownerId: i.ownerId,
    targetDate: i.targetDate?.toISOString() ?? null,
    targetDateResolution: i.targetDateResolution,
    targetDateFiscalYearStartMonth: i.targetDateFiscalYearStartMonth,
    childMix: { projects: projectRows.length, programs: programRows.length },
    projects: projectRows,
    programs: programRows,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Cycle: window, status, and the tasks grouped within it. */
export async function hydrateCycle(
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  const rows = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
    .limit(1);
  const cy = rows[0];
  if (!cy) throw new NotFoundError();

  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      state: task.state,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(and(eq(task.cycleId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)));

  return {
    id: cy.id,
    teamId: cy.teamId,
    number: cy.number,
    name: cy.name,
    // The same label the resolver offers as this cycle's handle (see `mcp/descriptors.ts`) and the
    // same one every REST surface renders: the author's `name`, else the window. Without it an
    // agent that resolved a cycle by its window would hydrate the resource and find `name: null`,
    // and the only other label available is `number` — an epoch-anchored auto-roll key that reads
    // as "Cycle 1000137" and matches nothing a person would say.
    displayName: cy.name ?? defaultCycleName(cy.startsAt, cy.endsAt),
    status: cy.status,
    startsAt: cy.startsAt.toISOString(),
    endsAt: cy.endsAt.toISOString(),
    tasks: taskRows.filter(canViewTask).map(taskRef),
  };
}
