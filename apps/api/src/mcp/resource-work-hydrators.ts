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
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';

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
export async function hydrateTask(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const t = rows[0];
  if (!t) throw new NotFoundError();

  const cols = { id: task.id, title: task.title, state: task.state, projectId: task.projectId };
  const [blocking, blockedBy, subtasks] = await Promise.all([
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
  ]);

  return {
    id: t.id,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
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
    blocking: blocking.map(taskRef),
    blockedBy: blockedBy.map(taskRef),
    subtasks: subtasks.map(taskRef),
    createdAt: t.createdAt.toISOString(),
  };
}

/** Project: overview, health, milestones, linked initiatives, latest update. */
export async function hydrateProject(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(project)
    .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
    .limit(1);
  const p = rows[0];
  if (!p) throw new NotFoundError();

  const [milestones, taskCountRows, initiativeRows, latestUpdate] = await Promise.all([
    db
      .select({ id: milestone.id, name: milestone.name, targetDate: milestone.targetDate })
      .from(milestone)
      .where(eq(milestone.projectId, id))
      .orderBy(asc(milestone.sort)),
    db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.projectId, id), isNull(task.archivedAt))),
    db
      .select({ id: initiative.id, name: initiative.name })
      .from(initiativeProject)
      .innerJoin(initiative, eq(initiativeProject.initiativeId, initiative.id))
      .where(and(eq(initiativeProject.projectId, id), eq(initiativeProject.organizationId, orgId))),
    latestUpdateFor(orgId, 'project', id),
  ]);

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    health: p.health,
    leadId: p.leadId,
    programId: p.programId,
    teamId: p.teamId,
    startDate: p.startDate?.toISOString() ?? null,
    targetDate: p.targetDate?.toISOString() ?? null,
    taskCount: taskCountRows.length,
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
export async function hydrateProgram(orgId: string, id: string): Promise<unknown> {
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
    .where(and(eq(project.programId, id), eq(project.organizationId, orgId)));
  const projectIds = projectRows.map((r) => r.id);

  const [taskRows, initiativeRows, latestUpdate] = await Promise.all([
    db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          isNull(task.archivedAt),
          projectIds.length > 0 ? inArray(task.projectId, projectIds) : eq(task.programId, id),
        ),
      ),
    db
      .select({ id: initiative.id, name: initiative.name })
      .from(initiativeProgram)
      .innerJoin(initiative, eq(initiativeProgram.initiativeId, initiative.id))
      .where(and(eq(initiativeProgram.programId, id), eq(initiativeProgram.organizationId, orgId))),
    latestUpdateFor(orgId, 'program', id),
  ]);

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    health: p.health,
    ownerId: p.ownerId,
    projects: projectRows,
    rollup: { projects: projectRows.length, tasks: taskRows.length },
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
        and(eq(initiativeProject.initiativeId, id), eq(initiativeProject.organizationId, orgId)),
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
    description: i.description,
    status: i.status,
    health: i.health,
    ownerId: i.ownerId,
    targetDate: i.targetDate?.toISOString() ?? null,
    childMix: { projects: projectRows.length, programs: programRows.length },
    projects: projectRows,
    programs: programRows,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Cycle: window, status, and the tasks grouped within it. */
export async function hydrateCycle(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, id), eq(cycle.organizationId, orgId)))
    .limit(1);
  const cy = rows[0];
  if (!cy) throw new NotFoundError();

  const taskRows = await db
    .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
    .from(task)
    .where(and(eq(task.cycleId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)));

  return {
    id: cy.id,
    teamId: cy.teamId,
    number: cy.number,
    name: cy.name,
    status: cy.status,
    startsAt: cy.startsAt.toISOString(),
    endsAt: cy.endsAt.toISOString(),
    tasks: taskRows.map(taskRef),
  };
}
