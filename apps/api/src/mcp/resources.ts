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
import type { ResourceKind } from '@docket/authz';
import { comment, db, task } from '@docket/db';
import type { McpRegistrar } from './catalog';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { buildTaskViewFilter } from '../routes/task-helpers';
import { registerApps } from './apps';
import type { McpActor, McpContext } from './auth';
import {
  hydrateAgent,
  hydrateComment,
  hydrateOrg,
  hydrateSession,
  hydrateTeam,
  hydrateUpdate,
  hydrateView,
} from './resource-meta-hydrators';
import {
  completeId,
  completeOrg,
  firstVar,
  jsonRead,
  registerStaticResources,
} from './resource-statics';
import {
  hydrateCycle,
  hydrateInitiative,
  hydrateProgram,
  hydrateProject,
  hydrateTask,
  type TaskViewFilter,
} from './resource-work-hydrators';
import { authorize, scopedActor } from './result';
import { RESOURCE_READ_SCOPE, requireScope } from './scope';

/** The entity types the `docket://{org}/{type}/{id}` template can read. */
export const READABLE_TYPES = [
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

/**
 * The `source_table` names that map onto a readable resource type.
 *
 * @remarks
 * Only these are addressable as `docket://{org}/{type}/{id}`, so only these are worth announcing
 * when they change. Kept beside {@link READABLE_TYPES} because the two must agree: a type readable
 * but absent here would be subscribable and never notified.
 */
const TABLE_TO_TYPE: Readonly<Record<string, ReadableType>> = {
  task: 'task',
  project: 'project',
  program: 'program',
  initiative: 'initiative',
  cycle: 'cycle',
  team: 'team',
  update: 'update',
  comment: 'comment',
  agent_session: 'session',
};

/**
 * The canonical `docket://` URI for one entity, or null when its table is not addressable.
 *
 * @remarks
 * The one place the scheme is written. It was previously built by string template on the write
 * path and taken apart by `new URL` on the read path, so the two could disagree about, say,
 * `agent_session` vs `session` without anything failing loudly.
 *
 * @param orgId - The owning organization.
 * @param sourceTable - The written table.
 * @param entityId - The written row.
 * @returns the URI, or null when nothing can subscribe to that table.
 */
export function entityUri(orgId: string, sourceTable: string, entityId: string): string | null {
  const type = TABLE_TO_TYPE[sourceTable];
  return type ? `docket://${orgId}/${type}/${entityId}` : null;
}

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

/** Require canonical current-task visibility before projecting a task-bound resource. */
async function assertTaskVisible(orgId: string, actorId: string, taskId: string): Promise<void> {
  const [target] = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const canViewTask = await buildTaskViewFilter(orgId, actorId);
  if (!target || !canViewTask(target)) throw new NotFoundError();
}

/**
 * The `view` gate every entity read passes, whatever addressed it.
 *
 * @remarks
 * The single place the two-layer check lives: the `work:read` scope, then the per-org `view`
 * cascade against the right resource kind — except tasks, whose public baseline and direct sharing
 * are resolved by the canonical task-view predicate. The resource template, the `get` tool, and
 * `resources/subscribe` all route through here, because three copies of this block is exactly how
 * subscribe silently becomes an oracle for entities a caller cannot read.
 *
 * @param ctx - The authenticated caller.
 * @param orgId - The organization the entity lives in.
 * @param type - The entity type.
 * @param id - The entity id.
 * @throws {NotFoundError} When the type is unknown or the entity is below the caller's view.
 */
export async function authorizeEntity(
  ctx: McpContext,
  orgId: string,
  type: string,
  id: string,
): Promise<McpActor> {
  if (!isReadableType(type)) throw new NotFoundError();
  const actorCtx = await scopedActor(ctx, orgId, RESOURCE_READ_SCOPE);

  if (type === 'task') {
    // Tasks have a deliberately richer read rule than the generic grant cascade: a public task
    // is visible to non-guests, and private tasks can be shared directly.
    await assertTaskVisible(orgId, actorCtx.actorId, id);
    return actorCtx;
  }

  if (type === 'comment') {
    // A task comment is a task projection, not an organization-level note. Resolve only its
    // subject pointer before the generic comment gate so neither the resource URI nor a semantic
    // batch read can expose its body, ids, or href when the owning task is hidden.
    const [target] = await db
      .select({ subjectType: comment.subjectType, subjectId: comment.subjectId })
      .from(comment)
      .where(and(eq(comment.id, id), eq(comment.organizationId, orgId)))
      .limit(1);
    if (!target) throw new NotFoundError();
    if (target.subjectType === 'task') {
      await assertTaskVisible(orgId, actorCtx.actorId, target.subjectId);
      return actorCtx;
    }
  }

  await authorize(actorCtx, 'view', {
    kind: resourceKindOf(type),
    id: authTargetId(type, orgId, id),
    orgId,
  });
  return actorCtx;
}

/**
 * Authorize a `docket://` URI for reading, without hydrating it.
 *
 * @remarks
 * Hub URIs (`docket://hub/...`) are caller-scoped by construction — they resolve against the
 * caller's own Hub — so they need no org gate. An agent principal has no Hub at all.
 *
 * @param ctx - The authenticated caller.
 * @param uri - The `docket://` URI being subscribed to.
 * @throws {NotFoundError} When the URI is unreadable, malformed, or below the caller's view.
 */
export async function authorizeResourceUri(ctx: McpContext, uri: string): Promise<void> {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'docket:') throw new NotFoundError();

  if (parsed.host === 'hub') {
    // Hub resources resolve against the caller's own Hub, so there is no org to authorize
    // against — only the token-level scope gate applies. An agent principal has no Hub at all,
    // so it cannot subscribe to one (existence-hiding, matching how the Hub tools treat agents).
    requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
    if (ctx.principal.kind === 'agent') throw new NotFoundError();
    return;
  }

  const [type, id] = parsed.pathname.replace(/^\//, '').split('/');
  const orgId = parsed.host;
  if (!orgId || !type || !id) throw new NotFoundError();
  await authorizeEntity(ctx, orgId, type, id);
}

/**
 * Authorize and hydrate one entity, the same way a `docket://` resource read does.
 *
 * @remarks
 * Shared with the `get` tool so a batch read cannot drift from the single read it batches — in
 * particular so it authorizes per entity rather than once for the request, which is the difference
 * between a batch read and a way around the permission cascade.
 *
 * @param ctx - The authenticated caller.
 * @param orgId - The organization the entity lives in.
 * @param type - The entity type.
 * @param id - The entity id.
 * @returns the hydrated DTO.
 * @throws {NotFoundError} When it does not exist or is below the caller's view.
 */
export async function readEntity(
  ctx: McpContext,
  orgId: string,
  type: string,
  id: string,
): Promise<unknown> {
  const actorCtx = await authorizeEntity(ctx, orgId, type, id);
  /* v8 ignore next -- @preserve authorizeEntity rejects an unknown type before this runs */
  if (!isReadableType(type)) throw new NotFoundError();
  return hydrate(type, orgId, id, await buildTaskViewFilter(orgId, actorCtx.actorId));
}

/**
 * Build the hydrated read DTO for one entity within an org, or throw not-found.
 *
 * @remarks
 * Each branch delegates to the appropriate hydrator module. Not-found is
 * existence-hiding -- the caller already passed the `view` authorization gate,
 * so reaching a missing row means the row truly does not exist in the org.
 *
 * @param type - The entity type.
 * @param orgId - The owning organization id.
 * @param id - The entity id.
 * @returns the hydrated DTO.
 * @throws {NotFoundError} When the entity does not exist in the org.
 */
async function hydrate(
  type: ReadableType,
  orgId: string,
  id: string,
  canViewTask: TaskViewFilter,
): Promise<unknown> {
  switch (type) {
    case 'org':
      return hydrateOrg(orgId, id);
    case 'task':
      return hydrateTask(orgId, id, canViewTask);
    case 'project':
      return hydrateProject(orgId, id, canViewTask);
    case 'program':
      return hydrateProgram(orgId, id, canViewTask);
    case 'initiative':
      return hydrateInitiative(orgId, id);
    case 'cycle':
      return hydrateCycle(orgId, id, canViewTask);
    case 'team':
      return hydrateTeam(orgId, id);
    case 'update':
      return hydrateUpdate(orgId, id);
    case 'comment':
      return hydrateComment(orgId, id, canViewTask);
    case 'session':
      return hydrateSession(orgId, id, canViewTask);
    case 'agent':
      return hydrateAgent(orgId, id);
    /* v8 ignore next 2 -- @preserve exhaustive: the only remaining case is `view` */
    case 'view':
      return hydrateView(orgId, id);
  }
}

/**
 * Register the Docket read resources on `server`, bound to the calling user.
 *
 * @remarks
 * The entity template resolves the caller's per-org actor and authorizes before returning the
 * HYDRATED DTO; task comments follow their owning task's canonical visibility. Static Hub
 * resources are delegated to
 * {@link registerStaticResources}. The `{org}` and `{id}` template variables complete
 * against the caller's visible orgs / recent entities.
 *
 * @param server - The per-request {@link McpServer} to register resources on.
 * @param ctx - The authenticated MCP caller.
 */
export function registerResources(server: McpRegistrar, ctx: McpContext): void {
  registerApps(server);
  registerStaticResources(server, ctx);

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
        'Read a hydrated task/project/program/initiative/cycle/team/update/comment/session/agent/view/org by id. Task comments follow current task visibility; other entities use their documented view gate.',
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
      return jsonRead(uri, await readEntity(ctx, orgId, typeRaw, id));
    },
  );
}
