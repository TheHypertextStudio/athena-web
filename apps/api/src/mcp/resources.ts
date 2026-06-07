/**
 * `@docket/api` -- MCP read resources (HYDRATED projections).
 *
 * @remarks
 * Reads are modeled as resources, not tools. The `docket://{org}/{type}/{id}` template
 * exposes the core entities, each gated by {@link authorize} with the `view` capability
 * before any row is returned (existence-hiding not-found on denial -> JSON-RPC `-32002`,
 * NOT forbidden -- a caller who cannot see a resource must not learn it exists). Unlike a
 * raw row dump, each read returns a HYDRATED DTO (mcp-surface.md section 4.3): a task
 * carries its dependencies + subtasks, a project its milestones + linked initiatives +
 * latest update, a program its child rollup, an initiative its associated children, a
 * session its full activity stream, etc.
 *
 * Static resources (`docket://orgs` + the Hub `today`/`inbox`/`portfolio`) are the
 * navigational entry points. The `{org}` and `{id}` template variables are completable
 * via the SDK's resource-template completion callbacks.
 *
 * `{org}`/`{id}` come from the URI for ADDRESSING only -- authorization always re-derives
 * the actor from the verified token's `sub` ({@link McpContext}); the URI is never
 * trusted for access.
 */
import {
  actor,
  agent,
  agentSession,
  comment,
  cycle,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  milestone,
  organization,
  program,
  project,
  savedView,
  sessionActivity,
  task,
  taskDependency,
  team,
  update,
} from '@docket/db';
import type { ResourceKind } from '@docket/authz';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, asc, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { authorize, scopedActor } from './result';
import { RESOURCE_READ_SCOPE } from './scope';

/** The entity types the `docket://{org}/{type}/{id}` template can read. */
const READABLE_TYPES = [
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
  'team',
  'update',
  'comment',
  'session',
  'agent',
  'view',
  'org',
] as const;
/** One readable entity type. */
type ReadableType = (typeof READABLE_TYPES)[number];

/** Whether `value` is a supported readable entity type. */
function isReadableType(value: string): value is ReadableType {
  return (READABLE_TYPES as readonly string[]).includes(value);
}

/**
 * Map a readable resource type to the authz {@link ResourceKind} it authorizes against.
 *
 * @remarks
 * `org` maps to `organization`; entities that are not themselves containment nodes
 * (`update`/`comment`/`session`/`agent`/`view`) authorize against the `organization`
 * root (org membership + the `view` cascade gate the whole org-scoped read).
 *
 * @param type - The readable entity type.
 * @returns the authz resource kind to check against.
 */
function resourceKindOf(type: ReadableType): ResourceKind {
  switch (type) {
    case 'task':
    case 'project':
    case 'program':
    case 'initiative':
    case 'cycle':
    case 'team':
      return type;
    default:
      return 'organization';
  }
}

/** The authorization target id for a read (the entity itself for nodes; the org otherwise). */
function authTargetId(type: ReadableType, orgId: string, id: string): string {
  return resourceKindOf(type) === 'organization' && type !== 'org' ? orgId : id;
}

/** Build the standard hydrated JSON read result for `uri`. */
function jsonRead(uri: URL, dto: unknown): ReadResourceResult {
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dto, null, 2) }],
  };
}

/** A lightweight task ref shared by hydrated DTOs (dependencies, subtasks). */
function taskRef(t: { id: string; title: string; state: string; projectId: string | null }): {
  id: string;
  title: string;
  state: string;
  projectId: string | null;
} {
  return { id: t.id, title: t.title, state: t.state, projectId: t.projectId };
}

/**
 * Build the hydrated read DTO for one entity within an org, or throw not-found.
 *
 * @remarks
 * Each branch returns related fields (not the raw row): the projections mirror what the
 * RPC detail endpoints hydrate, so an MCP client reading a resource sees the same shape
 * a human client would. Not-found is existence-hiding -- the caller already passed the
 * `view` authorization gate, so reaching a missing row means the row truly does not
 * exist in the org.
 *
 * @param type - The entity type.
 * @param orgId - The owning organization id.
 * @param id - The entity id.
 * @returns the hydrated DTO.
 * @throws {NotFoundError} When the entity does not exist in the org.
 */
async function hydrate(type: ReadableType, orgId: string, id: string): Promise<unknown> {
  switch (type) {
    case 'org':
      return hydrateOrg(orgId, id);
    case 'task':
      return hydrateTask(orgId, id);
    case 'project':
      return hydrateProject(orgId, id);
    case 'program':
      return hydrateProgram(orgId, id);
    case 'initiative':
      return hydrateInitiative(orgId, id);
    case 'cycle':
      return hydrateCycle(orgId, id);
    case 'team':
      return hydrateTeam(orgId, id);
    case 'update':
      return hydrateUpdate(orgId, id);
    case 'comment':
      return hydrateComment(orgId, id);
    case 'session':
      return hydrateSession(orgId, id);
    case 'agent':
      return hydrateAgent(orgId, id);
    /* v8 ignore next 2 -- @preserve exhaustive: the only remaining case is `view` */
    case 'view':
      return hydrateView(orgId, id);
  }
}

/** Org summary + entity counts. */
async function hydrateOrg(orgId: string, id: string): Promise<unknown> {
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

/** Full task: state, refs, dependencies (blocking + blocked-by), subtasks. */
async function hydrateTask(orgId: string, id: string): Promise<unknown> {
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
async function hydrateProject(orgId: string, id: string): Promise<unknown> {
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
async function hydrateProgram(orgId: string, id: string): Promise<unknown> {
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
async function hydrateInitiative(orgId: string, id: string): Promise<unknown> {
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
async function hydrateCycle(orgId: string, id: string): Promise<unknown> {
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

/** Team: workflow states, triage flag, members (human Actors). */
async function hydrateTeam(orgId: string, id: string): Promise<unknown> {
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
async function hydrateUpdate(orgId: string, id: string): Promise<unknown> {
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
async function hydrateComment(orgId: string, id: string): Promise<unknown> {
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
async function hydrateSession(orgId: string, id: string): Promise<unknown> {
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
async function hydrateAgent(orgId: string, id: string): Promise<unknown> {
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
async function hydrateView(orgId: string, id: string): Promise<unknown> {
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

/** The latest status update for a subject (drives the subject's current health). */
async function latestUpdateFor(
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

/**
 * Register the Docket read resources on `server`, bound to the calling user.
 *
 * @remarks
 * The entity template resolves the caller's per-org actor and authorizes `view` before
 * returning the HYDRATED DTO. `docket://orgs` lists the caller's memberships, and the
 * Hub `today`/`inbox`/`portfolio` resources surface the cross-org personal command
 * center (authorized purely by the token's `sub`). The `{org}` and `{id}` template
 * variables complete against the caller's visible orgs / recent entities.
 *
 * @param server - The per-request {@link McpServer} to register resources on.
 * @param ctx - The authenticated MCP caller.
 */
export function registerResources(server: McpServer, ctx: McpContext): void {
  server.registerResource(
    'orgs',
    'docket://orgs',
    {
      title: 'My organizations',
      description: 'The organizations the authenticated user belongs to.',
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      const rows = await callerOrgs(ctx);
      return jsonRead(uri, rows);
    },
  );

  server.registerResource(
    'hub-today',
    'docket://hub/today',
    {
      title: 'Hub - today',
      description: "The caller's cross-org tasks for today (Hub-scoped, by token sub).",
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      const orgIds = (await callerOrgs(ctx)).map((o) => o.id);
      const date = new Date().toISOString().slice(0, 10);
      const items =
        orgIds.length > 0
          ? await db
              .select({
                taskId: task.id,
                title: task.title,
                state: task.state,
                organizationId: task.organizationId,
                dueDate: task.dueDate,
              })
              .from(task)
              .where(and(inArray(task.organizationId, orgIds), isNull(task.archivedAt)))
              .limit(50)
          : [];
      return jsonRead(uri, {
        date,
        tasks: items.map((t) => ({
          taskId: t.taskId,
          title: t.title,
          state: t.state,
          organizationId: t.organizationId,
          dueDate: t.dueDate?.toISOString() ?? null,
        })),
      });
    },
  );

  server.registerResource(
    'hub-inbox',
    'docket://hub/inbox',
    {
      title: 'Hub - inbox',
      description: "The caller's cross-org items needing attention (Hub-scoped).",
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      // The Inbox surfaces what needs the caller's attention across orgs; here we project
      // the agent sessions awaiting the caller's approval (the highest-value inbox item).
      const orgIds = (await callerOrgs(ctx)).map((o) => o.id);
      const awaiting =
        orgIds.length > 0
          ? await db
              .select({ id: agentSession.id, taskId: agentSession.taskId })
              .from(agentSession)
              .where(
                and(
                  inArray(agentSession.organizationId, orgIds),
                  eq(agentSession.status, 'awaiting_approval'),
                ),
              )
          : [];
      return jsonRead(uri, {
        approvals: awaiting.map((a) => ({ sessionId: a.id, taskId: a.taskId })),
      });
    },
  );

  server.registerResource(
    'hub-portfolio',
    'docket://hub/portfolio',
    {
      title: 'Hub - portfolio',
      description: "The caller's cross-org programs + projects roadmap (Hub-scoped).",
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      const orgIds = (await callerOrgs(ctx)).map((o) => o.id);
      const [programs, projects] =
        orgIds.length > 0
          ? await Promise.all([
              db
                .select({
                  id: program.id,
                  name: program.name,
                  health: program.health,
                  organizationId: program.organizationId,
                })
                .from(program)
                .where(inArray(program.organizationId, orgIds)),
              db
                .select({
                  id: project.id,
                  name: project.name,
                  health: project.health,
                  status: project.status,
                  organizationId: project.organizationId,
                })
                .from(project)
                .where(inArray(project.organizationId, orgIds)),
            ])
          : [[], []];
      return jsonRead(uri, { programs, projects });
    },
  );

  server.registerResource(
    'entity',
    new ResourceTemplate('docket://{org}/{type}/{id}', {
      list: undefined,
      complete: {
        org: (value) => completeOrg(ctx, value),
        id: (value, context) => completeId(ctx, value, context?.arguments),
      },
    }),
    {
      title: 'Docket entity',
      description:
        'Read a hydrated task/project/program/initiative/cycle/team/update/comment/session/agent/view/org by id (gated by the view capability).',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const orgId = firstVar(variables['org']);
      const typeRaw = firstVar(variables['type']);
      const id = firstVar(variables['id']);
      if (!orgId || !typeRaw || !id || !isReadableType(typeRaw)) throw new NotFoundError();

      // Two-layer authorization (mcp-surface.md §2.2): the `work:read` scope gate first,
      // then the per-org `view` grant cascade. The URI is addressing only; the actor is
      // re-derived from the verified token.
      const actorCtx = await scopedActor(ctx, orgId, RESOURCE_READ_SCOPE);
      await authorize(actorCtx, 'view', {
        kind: resourceKindOf(typeRaw),
        id: authTargetId(typeRaw, orgId, id),
        orgId,
      });

      const dto = await hydrate(typeRaw, orgId, id);
      return jsonRead(uri, dto);
    },
  );
}

/** The orgs (id/name/slug) the caller is a human Actor in. */
async function callerOrgs(ctx: McpContext): Promise<{ id: string; name: string; slug: string }[]> {
  const rows = await db
    .select({ org: organization })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .where(and(eq(actor.userId, ctx.userId), eq(actor.kind, 'human')));
  return rows.map((r) => ({ id: r.org.id, name: r.org.name, slug: r.org.slug }));
}

/** Complete the `{org}` template var: the caller's org ids matching the prefix. */
async function completeOrg(ctx: McpContext, value: string): Promise<string[]> {
  const orgs = await callerOrgs(ctx);
  const v = value.toLowerCase();
  return orgs
    .filter((o) => o.id.toLowerCase().startsWith(v) || o.slug.toLowerCase().startsWith(v))
    .map((o) => o.id)
    .slice(0, 20);
}

/**
 * Complete the `{id}` template var: recent visible task ids in the resolved org.
 *
 * @remarks
 * Best-effort: when the `{org}` arg is bound and the caller is a member, return recent
 * task ids matching the prefix; otherwise an empty list (the client falls back to no
 * suggestions). Never throws -- completion is advisory.
 *
 * @param ctx - The authenticated MCP caller.
 * @param value - The partial id the user has typed.
 * @param args - The other already-resolved template args (carries `org`).
 * @returns up to 20 candidate ids.
 */
async function completeId(
  ctx: McpContext,
  value: string,
  args: Record<string, string> | undefined,
): Promise<string[]> {
  const orgId = args?.['org'];
  if (!orgId) return [];
  const member = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(eq(actor.userId, ctx.userId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')),
    )
    .limit(1);
  if (!member[0]) return [];
  const rows = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(eq(task.organizationId, orgId), isNull(task.archivedAt), ilike(task.id, `${value}%`)),
    )
    .orderBy(desc(task.createdAt))
    .limit(20);
  return rows.map((r) => r.id);
}

/** Read a single URI-template variable value (templates may bind a string or array). */
function firstVar(value: string | string[] | undefined): string | undefined {
  /* v8 ignore next -- @preserve the docket:// template binds single string values; the array form is unreachable here */
  if (Array.isArray(value)) return value[0];
  return value;
}
