import { actor, agentSession, db, organization, program, project, task } from '@docket/db';
import { DirectiveOut } from '@docket/planning/scheduling-directive-contract';
import type { McpRegistrar } from './catalog';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, desc, eq, ilike, inArray, isNull, lt, or } from 'drizzle-orm';

import { resourceAccessKey, resolveResourceAccess } from '../permissions/resource-access';
import { buildHubTodayPayload } from '../routes/hub-today';
import { buildTaskViewFilter } from '../routes/task-helpers';
import { computeDirective, loadDayContext } from '../services/scheduling/directive-service';
import { loadSchedulingPreferences } from '../services/scheduling/repository';
import { localDateString } from '@docket/planning/zoned-time';
import { resolveActor, type McpContext } from './auth';
import { callerHub } from './plan-tools';
import { RESOURCE_READ_SCOPE, requireScope } from './scope';

/** Build the standard hydrated JSON read result for `uri`. */
export function jsonRead(uri: URL, dto: unknown): ReadResourceResult {
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dto, null, 2) }],
  };
}

interface ActiveHumanMembership {
  readonly actorId: string;
  readonly org: { id: string; name: string; slug: string };
}

/** Load the caller's currently active human memberships, including their per-org actor ids. */
async function activeHumanMemberships(userId: string): Promise<ActiveHumanMembership[]> {
  const rows = await db
    .select({ org: organization, actorId: actor.id })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  return rows;
}

/** The caller's current orgs: active human memberships, or an agent's one org. */
export async function callerOrgs(
  ctx: McpContext,
): Promise<{ id: string; name: string; slug: string }[]> {
  if (ctx.principal.kind === 'agent') {
    const rows = await db
      .select({ org: organization })
      .from(organization)
      .where(eq(organization.id, ctx.principal.orgId));
    return rows.map((r) => ({ id: r.org.id, name: r.org.name, slug: r.org.slug }));
  }
  const rows = await activeHumanMemberships(ctx.principal.userId);
  return rows.map((r) => r.org);
}

/** Complete the `{org}` template var: the caller's org ids matching the prefix. */
export async function completeOrg(ctx: McpContext, value: string): Promise<string[]> {
  requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
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
export async function completeId(
  ctx: McpContext,
  value: string,
  args: Record<string, string> | undefined,
): Promise<string[]> {
  requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
  const orgId = args?.['org'];
  if (!orgId) return [];
  let actorId: string;
  try {
    actorId = (await resolveActor(ctx, orgId)).actorId;
  } catch {
    return [];
  }
  const canViewTask = await buildTaskViewFilter(orgId, actorId);
  const ids: string[] = [];
  let after: { createdAt: Date; id: string } | undefined;

  // Completion has no cursor, so scan only until it has its twenty visible suggestions. A hidden
  // recent task must not crowd out a directly granted one that comes immediately after it.
  while (ids.length < 20) {
    const rows = await db
      .select({
        id: task.id,
        teamId: task.teamId,
        projectId: task.projectId,
        programId: task.programId,
        visibility: task.visibility,
        createdAt: task.createdAt,
      })
      .from(task)
      .where(
        and(
          eq(task.organizationId, orgId),
          isNull(task.archivedAt),
          ilike(task.id, `${value}%`),
          after
            ? or(
                lt(task.createdAt, after.createdAt),
                and(eq(task.createdAt, after.createdAt), lt(task.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(task.createdAt), desc(task.id))
      .limit(20);
    ids.push(...rows.filter(canViewTask).map((row) => row.id));
    if (rows.length < 20) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    after = { createdAt: last.createdAt, id: last.id };
  }
  return ids.slice(0, 20);
}

/** Read a single URI-template variable value (templates may bind a string or array). */
export function firstVar(value: string | string[] | undefined): string | undefined {
  /* v8 ignore next -- @preserve the docket:// template binds single string values; the array form is unreachable here */
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Register the five static Hub resources on `server`: orgs list, hub-today,
 * hub-inbox, hub-portfolio, and hub-directive. All are gated by the caller principal
 * (token sub only; no per-org actor resolution needed for cross-org personal surfaces).
 */
export function registerStaticResources(server: McpRegistrar, ctx: McpContext): void {
  server.registerResource(
    'orgs',
    'docket://orgs',
    {
      title: 'My organizations',
      description: 'The organizations the authenticated user belongs to.',
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
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
      requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
      const date = new Date().toISOString().slice(0, 10);
      // Built by the same function behind the `brief` tool and the Hub Today screen. This used to
      // run its own query with no date filter and no assignee filter at all — it announced
      // "today" and returned fifty arbitrary unarchived tasks from every org the caller belonged
      // to, which is worse than returning nothing, because it looks like an answer.
      if (ctx.principal.kind === 'agent') return jsonRead(uri, { date, tasks: [] });
      const payload = await buildHubTodayPayload(ctx.principal.userId, date);
      return jsonRead(uri, {
        date,
        tasks: payload.plan.map((t) => ({
          taskId: t.id,
          title: t.title,
          state: t.state,
          organizationId: t.organizationId,
          dueDate: t.dueDate ?? null,
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
      requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
      // The Inbox surfaces what needs the caller's attention across orgs; here we project
      // the agent sessions awaiting the caller's approval (the highest-value inbox item).
      if (ctx.principal.kind === 'agent') return jsonRead(uri, { approvals: [] });
      const memberships = await activeHumanMemberships(ctx.principal.userId);
      const membershipByOrg = new Map(
        memberships.map((membership) => [membership.org.id, membership]),
      );
      const orgIds = [...membershipByOrg.keys()];
      const awaiting =
        orgIds.length > 0
          ? await db
              .select({
                id: agentSession.id,
                organizationId: agentSession.organizationId,
                taskId: agentSession.taskId,
              })
              .from(agentSession)
              .where(
                and(
                  inArray(agentSession.organizationId, orgIds),
                  eq(agentSession.status, 'awaiting_approval'),
                ),
              )
          : [];
      const taskIds = awaiting.flatMap((session) => (session.taskId ? [session.taskId] : []));
      const taskRows =
        taskIds.length > 0
          ? await db
              .select({
                id: task.id,
                organizationId: task.organizationId,
                teamId: task.teamId,
                projectId: task.projectId,
                programId: task.programId,
                visibility: task.visibility,
              })
              .from(task)
              .where(
                and(
                  inArray(task.organizationId, orgIds),
                  inArray(task.id, taskIds),
                  isNull(task.archivedAt),
                ),
              )
          : [];
      const taskFilters = new Map(
        await Promise.all(
          memberships.map(
            async (membership) =>
              [
                membership.org.id,
                await buildTaskViewFilter(membership.org.id, membership.actorId),
              ] as const,
          ),
        ),
      );
      const visibleTaskKeys = new Set(
        taskRows
          .filter((row) => taskFilters.get(row.organizationId)?.(row))
          .map((row) => `${row.organizationId}:${row.id}`),
      );
      return jsonRead(uri, {
        // A taskless session has no task identity to authorize and remains visible in the caller's
        // Hub. Omit a hidden task-bound session entirely so neither its task nor session id becomes
        // an approval-existence oracle.
        approvals: awaiting
          .filter(
            (session) =>
              session.taskId === null ||
              visibleTaskKeys.has(`${session.organizationId}:${session.taskId}`),
          )
          .map((session) => ({ sessionId: session.id, taskId: session.taskId })),
      });
    },
  );

  server.registerResource(
    'hub-directive',
    'docket://hub/directive',
    {
      title: 'Hub - directive',
      description:
        "The caller's daily directive: today's committed plan, a posture with a plain-language reason, at most one narrowing recommendation, and the gates the day is waiting on (Hub-scoped, by token sub). Subscribable; re-read on notifications/resources/updated.",
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> => {
      // The scope gate is asserted in the handler (mirroring `authorizeResourceUri`'s Hub
      // branch, which already gates subscribe the same way) because this surface exists for
      // unattended third-party clients whose tokens may carry any scope subset — unlike its
      // sibling statics, whose consumers are effectively first-party and full-scope.
      requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
      // Always today in the Hub's timezone — a device-control client asking "what should I be
      // doing right now" never means another day, so there is deliberately no date parameter.
      const { hubId, userId } = await callerHub(ctx);
      const preferences = await loadSchedulingPreferences(db, hubId);
      const date = localDateString(new Date(), preferences.timezone);
      const context = await loadDayContext(db, { hubId, userId, date });
      // The same service call backing `GET /v1/directive`, so an MCP consumer can never see a
      // different day than the app does. Parsed through the DTO so the wire shape is guaranteed,
      // exactly like the HTTP route's response serialization.
      const payload = await computeDirective(db, context, {});
      return jsonRead(uri, DirectiveOut.parse(payload));
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
      requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
      if (ctx.principal.kind === 'agent') return jsonRead(uri, { programs: [], projects: [] });
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
                .where(and(inArray(project.organizationId, orgIds), isNull(project.archivedAt))),
            ])
          : [[], []];
      const access = await resolveResourceAccess(ctx.principal.userId, [
        ...programs.map((row) => ({
          organizationId: row.organizationId,
          kind: 'program',
          id: row.id,
        })),
        ...projects.map((row) => ({
          organizationId: row.organizationId,
          kind: 'project',
          id: row.id,
        })),
      ]);
      return jsonRead(uri, {
        programs: programs.filter(
          (row) =>
            access.get(
              resourceAccessKey({
                organizationId: row.organizationId,
                kind: 'program',
                id: row.id,
              }),
            )?.canView,
        ),
        projects: projects.filter(
          (row) =>
            access.get(
              resourceAccessKey({
                organizationId: row.organizationId,
                kind: 'project',
                id: row.id,
              }),
            )?.canView,
        ),
      });
    },
  );
}
