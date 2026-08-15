import {
  actor,
  agent,
  agentSession,
  comment,
  db,
  organization,
  program,
  project,
  savedView,
  sessionActivity,
  task,
  team,
  update,
} from '@docket/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { TaskViewFilter } from './resource-work-hydrators';

/** Org summary + entity counts. */
export async function hydrateOrg(orgId: string, id: string): Promise<unknown> {
  const rows = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
  const org = rows[0];
  if (org?.id !== id) throw new NotFoundError();
  const [teams, projects, programs] = await Promise.all([
    db.select({ id: team.id }).from(team).where(eq(team.organizationId, orgId)),
    db.select({ id: project.id }).from(project).where(eq(project.organizationId, orgId)),
    db.select({ id: program.id }).from(program).where(eq(program.organizationId, orgId)),
  ]);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    isPersonal: org.isPersonal,
    vocabulary: org.vocabulary,
    counts: { teams: teams.length, projects: projects.length, programs: programs.length },
  };
}

/** Team: workflow states, triage flag, members (human Actors). */
export async function hydrateTeam(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(team)
    .where(and(eq(team.id, id), eq(team.organizationId, orgId)))
    .limit(1);
  const t = rows[0];
  if (!t) throw new NotFoundError();

  const members = await db
    .select({ id: actor.id, displayName: actor.displayName })
    .from(actor)
    .where(and(eq(actor.organizationId, orgId), eq(actor.kind, 'human'), isNull(actor.archivedAt)));

  return {
    id: t.id,
    name: t.name,
    key: t.key,
    description: t.description,
    workflowStates: t.workflowStates,
    triageEnabled: t.triageEnabled,
    members,
  };
}

/** Update: author, subject ref, health, body, timestamp. */
export async function hydrateUpdate(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(update)
    .where(and(eq(update.id, id), eq(update.organizationId, orgId)))
    .limit(1);
  const u = rows[0];
  if (!u) throw new NotFoundError();
  const authorRows = u.authorId
    ? await db
        .select({ id: actor.id, displayName: actor.displayName })
        .from(actor)
        .where(and(eq(actor.id, u.authorId), eq(actor.organizationId, orgId)))
        .limit(1)
    : [];
  const author = authorRows[0] ?? null;
  return {
    id: u.id,
    authorId: u.authorId,
    subjectType: u.subjectType,
    subjectId: u.subjectId,
    author,
    health: u.health,
    body: u.body,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Comment: author, subject ref, body, thread parent. */
export async function hydrateComment(
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  const rows = await db
    .select()
    .from(comment)
    .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
    .limit(1);
  const c = rows[0];
  if (!c) throw new NotFoundError();
  if (c.subjectType === 'task') {
    // Keep the hydrator self-defending: callers can never accidentally serialize a task comment
    // merely because they remembered the generic comment gate but skipped the owning task gate.
    const [subject] = await db
      .select({
        id: task.id,
        teamId: task.teamId,
        projectId: task.projectId,
        programId: task.programId,
        visibility: task.visibility,
      })
      .from(task)
      .where(and(eq(task.id, c.subjectId), eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .limit(1);
    if (!subject || !canViewTask(subject)) throw new NotFoundError();
  }
  const authorRows = c.authorId
    ? await db
        .select({ id: actor.id, displayName: actor.displayName })
        .from(actor)
        .where(and(eq(actor.id, c.authorId), eq(actor.organizationId, orgId)))
        .limit(1)
    : [];
  const author = authorRows[0] ?? null;
  return {
    id: c.id,
    authorId: c.authorId,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    author,
    body: c.body,
    parentCommentId: c.parentCommentId,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Agent Session: status, agent, task ref, trigger, accountability, activity stream. */
export async function hydrateSession(
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const s = rows[0];
  if (!s) throw new NotFoundError();

  const [activities, agentRows, taskRows] = await Promise.all([
    db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, id))
      .orderBy(asc(sessionActivity.createdAt)),
    s.agentId
      ? db
          .select({ id: agent.id, displayName: actor.displayName })
          .from(agent)
          .innerJoin(actor, eq(agent.actorId, actor.id))
          .where(and(eq(agent.id, s.agentId), eq(agent.organizationId, orgId)))
          .limit(1)
      : Promise.resolve([]),
    s.taskId
      ? db
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
          .where(
            and(eq(task.id, s.taskId), eq(task.organizationId, orgId), isNull(task.archivedAt)),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  const visibleTask = taskRows[0] && canViewTask(taskRows[0]) ? taskRows[0] : null;
  // Session activities often quote the task title or a tool summary. Once the task reference is
  // hidden, retaining its transcript would recreate the same disclosure through a side channel.
  const visibleActivities = s.taskId && !visibleTask ? [] : activities;

  return {
    id: s.id,
    agentId: s.agentId,
    taskId: visibleTask?.id ?? null,
    agent: agentRows[0] ?? null,
    task: visibleTask
      ? { id: visibleTask.id, title: visibleTask.title, state: visibleTask.state }
      : null,
    trigger: s.trigger,
    status: s.status,
    accountability: { initiatorId: s.initiatorId },
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    activities: visibleActivities.map((a) => ({
      id: a.id,
      type: a.type,
      body: a.body,
      approvalStatus: a.approvalStatus,
      createdAt: a.createdAt.toISOString(),
    })),
    createdAt: s.createdAt.toISOString(),
  };
}

/** Agent: provider connection (NO credentials), policy, accountable owner, guidance. */
export async function hydrateAgent(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(agent)
    .where(and(eq(agent.id, id), eq(agent.organizationId, orgId)))
    .limit(1);
  const a = rows[0];
  if (!a) throw new NotFoundError();
  const actorRows = await db
    .select({ displayName: actor.displayName })
    .from(actor)
    .where(and(eq(actor.id, a.actorId), eq(actor.organizationId, orgId)))
    .limit(1);
  // The connection carries endpoint/protocol only -- credentials live in the boundary
  // layer and are never surfaced over MCP (no token passthrough; mcp-surface.md 4.3).
  const connection = a.connection
    ? { protocol: a.connection.protocol, endpoint: a.connection.endpoint }
    : null;
  return {
    id: a.id,
    actorId: a.actorId,
    displayName: actorRows[0]?.displayName ?? null,
    connection,
    approvalPolicy: a.approvalPolicy,
    accountableOwnerId: a.accountableOwnerId,
    guidance: a.guidance,
  };
}

/** Saved View: the stored definition only. Executing a saved view is not yet supported; `list_work` takes its filters as arguments instead. */
export async function hydrateView(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(savedView)
    .where(and(eq(savedView.id, id), eq(savedView.organizationId, orgId)))
    .limit(1);
  const v = rows[0];
  if (!v) throw new NotFoundError();
  return {
    id: v.id,
    name: v.name,
    scope: v.scope,
    ownerActorId: v.ownerActorId,
    teamId: v.teamId,
    filters: v.filters,
    grouping: v.grouping ?? null,
    sort: v.sort,
  };
}
