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
  team,
  update,
} from '@docket/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';

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
  return {
    id: u.id,
    authorId: u.authorId,
    subjectType: u.subjectType,
    subjectId: u.subjectId,
    health: u.health,
    body: u.body,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Comment: author, subject ref, body, thread parent. */
export async function hydrateComment(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(comment)
    .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
    .limit(1);
  const c = rows[0];
  if (!c) throw new NotFoundError();
  return {
    id: c.id,
    authorId: c.authorId,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    body: c.body,
    parentCommentId: c.parentCommentId,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Agent Session: status, agent, task ref, trigger, accountability, activity stream. */
export async function hydrateSession(orgId: string, id: string): Promise<unknown> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, id), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const s = rows[0];
  if (!s) throw new NotFoundError();

  const activities = await db
    .select()
    .from(sessionActivity)
    .where(eq(sessionActivity.sessionId, id))
    .orderBy(asc(sessionActivity.createdAt));

  return {
    id: s.id,
    agentId: s.agentId,
    taskId: s.taskId,
    trigger: s.trigger,
    status: s.status,
    accountability: { initiatorId: s.initiatorId },
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    activities: activities.map((a) => ({
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
  // The connection carries endpoint/protocol only -- credentials live in the boundary
  // layer and are never surfaced over MCP (no token passthrough; mcp-surface.md 4.3).
  const connection = a.connection
    ? { protocol: a.connection.protocol, endpoint: a.connection.endpoint }
    : null;
  return {
    id: a.id,
    actorId: a.actorId,
    connection,
    approvalPolicy: a.approvalPolicy,
    accountableOwnerId: a.accountableOwnerId,
    guidance: a.guidance,
  };
}

/** Saved View: the view definition (results come from the `run_view` tool). */
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
