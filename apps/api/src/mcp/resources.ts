/**
 * `@docket/api` — MCP read resources.
 *
 * @remarks
 * Reads are modeled as resources, not tools. A single URI template
 * `docket://{org}/{type}/{id}` exposes the core entities (task / project / program /
 * initiative / org), each gated by {@link authorize} with the `view` capability
 * before any row is returned (existence-hiding 404 on denial). A static
 * `docket://orgs` resource lists the orgs the caller belongs to — the natural entry
 * point a client uses to discover the `{org}` ids the template needs.
 */
import { actor, db, initiative, organization, program, project, task } from '@docket/db';
import type { ResourceKind } from '@docket/authz';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { resolveActor } from './auth';
import { authorize } from './result';

/** The entity types the `docket://{org}/{type}/{id}` template can read. */
const READABLE_TYPES = ['task', 'project', 'program', 'initiative', 'org'] as const;
/** One readable entity type. */
type ReadableType = (typeof READABLE_TYPES)[number];

/** Whether `value` is a supported readable entity type. */
function isReadableType(value: string): value is ReadableType {
  return (READABLE_TYPES as readonly string[]).includes(value);
}

/** Map a readable resource type to the authz {@link ResourceKind} it authorizes against. */
function resourceKindOf(type: ReadableType): ResourceKind {
  return type === 'org' ? 'organization' : type;
}

/**
 * Load the row for one readable entity within an org, or throw 404.
 *
 * @param type - The entity type.
 * @param orgId - The owning organization id.
 * @param id - The entity id.
 * @returns the serializable row.
 * @throws {NotFoundError} When the entity does not exist in the org.
 */
async function loadEntity(type: ReadableType, orgId: string, id: string): Promise<unknown> {
  if (type === 'org') {
    const rows = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
    if (rows[0]?.id !== id) throw new NotFoundError();
    return rows[0];
  }
  const tbl = { task, project, program, initiative }[type];
  const rows = await db
    .select()
    .from(tbl)
    .where(and(eq(tbl.id, id), eq(tbl.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/**
 * Register the Docket read resources on `server`, bound to the calling user.
 *
 * @remarks
 * The entity template resolves the caller's per-org actor and authorizes `view`
 * before returning the row as JSON. The `docket://orgs` list resource enumerates the
 * caller's human-actor memberships (no per-org check needed — membership IS the
 * authorization), so a client can discover the org ids the template consumes.
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
      const rows = await db
        .select({ org: organization })
        .from(actor)
        .innerJoin(organization, eq(actor.organizationId, organization.id))
        .where(and(eq(actor.userId, ctx.userId), eq(actor.kind, 'human')));
      const items = rows.map((r) => ({ id: r.org.id, name: r.org.name, slug: r.org.slug }));
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(items, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'entity',
    new ResourceTemplate('docket://{org}/{type}/{id}', { list: undefined }),
    {
      title: 'Docket entity',
      description:
        'Read a task, project, program, initiative, or org by id (gated by the view capability).',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const orgId = firstVar(variables['org']);
      const typeRaw = firstVar(variables['type']);
      const id = firstVar(variables['id']);
      if (!orgId || !typeRaw || !id || !isReadableType(typeRaw)) throw new NotFoundError();

      const actorCtx = await resolveActor(ctx, orgId);
      await authorize(actorCtx, 'view', { kind: resourceKindOf(typeRaw), id, orgId });

      const entity = await loadEntity(typeRaw, orgId, id);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(entity, null, 2) },
        ],
      };
    },
  );
}

/** Read a single URI-template variable value (templates may bind a string or array). */
function firstVar(value: string | string[] | undefined): string | undefined {
  /* v8 ignore next -- @preserve the docket:// template binds single string values; the array form is unreachable here */
  if (Array.isArray(value)) return value[0];
  return value;
}
