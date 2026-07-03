import { actor, agentSession, db, organization, program, project, task } from '@docket/db';
import type { McpRegistrar } from './catalog';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';

import type { McpContext } from './auth';

/** Build the standard hydrated JSON read result for `uri`. */
export function jsonRead(uri: URL, dto: unknown): ReadResourceResult {
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(dto, null, 2) }],
  };
}

/** The orgs (id/name/slug) the caller belongs to: a user's memberships, or an agent's one org. */
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
  const rows = await db
    .select({ org: organization })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .where(and(eq(actor.userId, ctx.principal.userId), eq(actor.kind, 'human')));
  return rows.map((r) => ({ id: r.org.id, name: r.org.name, slug: r.org.slug }));
}

/** Complete the `{org}` template var: the caller's org ids matching the prefix. */
export async function completeOrg(ctx: McpContext, value: string): Promise<string[]> {
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
  const orgId = args?.['org'];
  if (!orgId) return [];
  if (ctx.principal.kind === 'agent') {
    if (ctx.principal.orgId !== orgId) return [];
  } else {
    const member = await db
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.userId, ctx.principal.userId),
          eq(actor.organizationId, orgId),
          eq(actor.kind, 'human'),
        ),
      )
      .limit(1);
    if (!member[0]) return [];
  }
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
export function firstVar(value: string | string[] | undefined): string | undefined {
  /* v8 ignore next -- @preserve the docket:// template binds single string values; the array form is unreachable here */
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Register the four static Hub resources on `server`: orgs list, hub-today,
 * hub-inbox, and hub-portfolio. All are gated by the caller principal (token sub only;
 * no per-org actor resolution needed for cross-org personal surfaces).
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
}
