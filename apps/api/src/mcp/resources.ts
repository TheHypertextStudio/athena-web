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
import type { McpRegistrar } from './catalog';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
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
} from './resource-work-hydrators';
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

/**
 * Register the Docket read resources on `server`, bound to the calling user.
 *
 * @remarks
 * The entity template resolves the caller's per-org actor and authorizes `view` before
 * returning the HYDRATED DTO. Static Hub resources are delegated to
 * {@link registerStaticResources}. The `{org}` and `{id}` template variables complete
 * against the caller's visible orgs / recent entities.
 *
 * @param server - The per-request {@link McpServer} to register resources on.
 * @param ctx - The authenticated MCP caller.
 */
export function registerResources(server: McpRegistrar, ctx: McpContext): void {
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
