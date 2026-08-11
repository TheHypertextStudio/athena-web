import { SearchDocumentKind, type SearchResult, type SearchRoute } from '@docket/types';
import { z } from 'zod';

import { type SearchCaller, searchWorkspace } from '../search/query';
import type { McpContext } from './auth';
import { registerOptionalTaskTool, type McpRegistrar } from './catalog';
import { WIDGET, widgetMeta } from './apps';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { createTaskToolHandler } from './task-tools';
import { ApiError } from '../error';
import { DESCRIPTOR_HINT, type DescriptorKind, resolveDescriptor } from './descriptors';
import { READABLE_TYPES, readEntity } from './resources';

/**
 * Which readable types can also be addressed by name.
 *
 * @remarks
 * Tasks, comments, updates, sessions, agents, and saved views have no stable human handle — a task
 * title is neither unique nor short-lived enough to resolve — so those stay id-only.
 */
const NAMEABLE: Partial<Record<(typeof READABLE_TYPES)[number], DescriptorKind>> = {
  project: 'project',
  program: 'program',
  initiative: 'initiative',
  team: 'team',
  cycle: 'cycle',
};

type ReadableType = (typeof READABLE_TYPES)[number];

const entityRefsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(50)
  .describe(
    'The entities to read. Named references are accepted where that entity type supports them.',
  );

const entityReadOutputSchema = {
  items: z.array(z.looseObject({ id: z.string(), href: z.string() })),
  missing: z.array(z.object({ ref: z.string(), reason: z.string() })),
};

const SEMANTIC_READ_TOOLS = [
  ['task', 'get_tasks', 'Tasks', WIDGET.tasks],
  ['project', 'get_projects', 'Projects', WIDGET.projects],
  ['program', 'get_programs', 'Programs', WIDGET.programs],
  ['initiative', 'get_initiatives', 'Initiatives', WIDGET.initiatives],
  ['cycle', 'get_cycles', 'Cycles', WIDGET.cycles],
  ['team', 'get_teams', 'Teams', WIDGET.teams],
  ['update', 'get_updates', 'Updates', WIDGET.updates],
  ['comment', 'get_comments', 'Comments', WIDGET.comments],
  ['session', 'get_sessions', 'Sessions', WIDGET.sessions],
  ['agent', 'get_agents', 'Agents', WIDGET.agents],
  ['view', 'get_views', 'Views', WIDGET.views],
  ['org', 'get_organizations', 'Organizations', WIDGET.organizations],
] as const satisfies readonly [ReadableType, string, string, string][];

/** Build the first-party route once on the trusted server, never in a widget. */
function entityHref(orgId: string, type: ReadableType, id: string): string {
  switch (type) {
    case 'task':
      return `/orgs/${orgId}/tasks/${id}`;
    case 'project':
      return `/orgs/${orgId}/projects/${id}`;
    case 'program':
      return `/orgs/${orgId}/programs/${id}`;
    case 'initiative':
      return `/orgs/${orgId}/initiatives/${id}`;
    case 'cycle':
      return `/orgs/${orgId}/cycles/${id}`;
    case 'session':
      return `/orgs/${orgId}/sessions/${id}`;
    case 'team':
      return `/orgs/${orgId}/teams`;
    case 'agent':
      return `/orgs/${orgId}/agents`;
    case 'view':
      return `/orgs/${orgId}/views?viewId=${id}`;
    case 'update':
    case 'comment':
      return `/orgs/${orgId}/search?kind=${type}&id=${id}`;
    case 'org':
      return `/orgs/${orgId}`;
  }
}

/** Add presentation-safe navigation to an otherwise unchanged hydrated read DTO. */
function withEntityHref(
  value: unknown,
  orgId: string,
  type: ReadableType,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(500, 'internal', 'Internal error');
  }
  const item = value as Record<string, unknown>;
  const id = typeof item['id'] === 'string' ? item['id'] : null;
  if (!id) throw new ApiError(500, 'internal', 'Internal error');
  return { ...item, href: entityHref(orgId, type, id) };
}

/** Read a same-type batch with the same resolution and authorization semantics as legacy `get`. */
async function readEntities(
  ctx: McpContext,
  orgId: string,
  type: ReadableType,
  refs: readonly string[],
): Promise<Record<string, unknown>> {
  const kind = NAMEABLE[type];
  const settled = await Promise.all(
    refs.map(async (ref) => {
      try {
        const id = kind ? await resolveDescriptor(orgId, kind, ref, 'refs') : ref;
        return {
          ok: true as const,
          value: withEntityHref(await readEntity(ctx, orgId, type, id), orgId, type),
        };
      } catch (err) {
        return { ok: false as const, ref, reason: err instanceof ApiError ? err.code : 'internal' };
      }
    }),
  );
  return {
    items: settled.filter((row) => row.ok).map((row) => row.value),
    missing: settled.filter((row) => !row.ok).map(({ ref, reason }) => ({ ref, reason })),
  };
}
import { listWork, listWorkFilters, WORK_ENTITIES, WorkRow } from './list-work';
import { decodeWorkCursor, orgIdParam, pageWorkRows } from './tools-shared';

const listWorkInputSchema = {
  orgId: orgIdParam,
  entity: z
    .enum(WORK_ENTITIES)
    .describe('Which kind of work to enumerate. Filters are validated against this choice.'),
  // Spread rather than restated: a filter the query understands is a filter the tool accepts.
  ...listWorkFilters,
  limit: z.number().int().min(1).max(200).default(50).describe('Maximum rows to return.'),
  cursor: z.string().optional().describe('An opaque cursor from a previous page.'),
};

const listWorkOutputSchema = {
  entity: z.enum(WORK_ENTITIES),
  items: z.array(WorkRow),
  nextCursor: z.string().optional(),
};

const findInputSchema = {
  orgId: orgIdParam,
  query: z
    .string()
    .min(1)
    .describe('What to look for. Matched against titles, summaries, and body text.'),
  kinds: z
    .array(SearchDocumentKind)
    .optional()
    .describe('Restrict to these kinds of thing. Omit to search everything.'),
  assigneeIds: z.array(z.string()).optional().describe('Only items assigned to these actor ids.'),
  ownerIds: z.array(z.string()).optional().describe('Only items owned or led by these actor ids.'),
  labelIds: z.array(z.string()).optional().describe('Only items carrying these label ids.'),
  statuses: z
    .array(z.string())
    .optional()
    .describe("Only items in these statuses or workflow states (e.g. 'active', 'todo')."),
  from: z.iso.datetime().optional().describe('Only items updated at or after this instant.'),
  to: z.iso.datetime().optional().describe('Only items updated at or before this instant.'),
  includeArchived: z.boolean().default(false).describe('Include archived items.'),
  limit: z.number().int().min(1).max(50).default(20).describe('Maximum results to return.'),
  cursor: z.string().optional().describe('An opaque cursor from a previous page of results.'),
};

const findOutputSchema = {
  items: z.array(
    z.object({
      kind: z.string(),
      id: z.string(),
      title: z.string(),
      summary: z.string().optional(),
      subjectKind: z.string().optional(),
      subjectId: z.string().optional(),
    }),
  ),
  facets: z.array(z.looseObject({ field: z.string() })),
  nextCursor: z.string().optional(),
};

/**
 * Project the caller onto the identity the search engine filters visibility by.
 *
 * @param ctx - The authenticated MCP caller.
 * @returns the matching {@link SearchCaller}.
 */
function searchCallerFor(ctx: McpContext): SearchCaller {
  return ctx.principal.kind === 'user'
    ? { kind: 'user', userId: ctx.principal.userId }
    : {
        kind: 'agent',
        actorId: ctx.principal.agentActorId,
        organizationId: ctx.principal.orgId,
      };
}

/**
 * Reduce a search route to the id an agent can actually act on next.
 *
 * @remarks
 * A result's own document id (`task:<org>:<entity>`) is an index key, not something any tool
 * accepts. The route is where the real entity id lives, and it differs per result shape — an
 * `entity` hit points at itself, a `content` hit at the comment or update, an `activity` hit at
 * the event. Purely external hits have no Docket id at all.
 *
 * @param route - The result's typed route.
 * @returns the actionable id, or null when the hit lives entirely outside Docket.
 */
function actionableId(route: SearchRoute): string | null {
  switch (route.type) {
    case 'entity':
      return route.entityId;
    case 'content':
      return route.contentId;
    case 'activity':
      return route.eventId;
    case 'calendar_event':
      return route.calendarEventId;
    case 'external':
      return null;
  }
}

/**
 * Shape one search hit for a tool caller.
 *
 * @param item - The engine's result row.
 * @returns the compact projection, or null when the hit carries no actionable Docket id.
 */
function findItem(item: SearchResult) {
  const id = actionableId(item.route);
  if (!id) return null;
  return {
    kind: item.kind,
    id,
    title: item.title,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.subject ? { subjectKind: item.subject.kind, subjectId: item.subject.id } : {}),
  };
}

/** Register list_work, find, and get on `server`. */
export function registerViewPlanTools(server: McpRegistrar, ctx: McpContext): void {
  const listWorkTool = (input: z.infer<z.ZodObject<typeof listWorkInputSchema>>) =>
    runTool(async () => {
      // A read still requires `view` on the org root; a caller who can't see the org
      // gets the existence-hiding not-found (-32002 surfaced as isError text), never a
      // forbidden — mcp-surface.md §3.1.
      const actorCtx = await scopedActor(ctx, input.orgId, 'work:read');
      await authorize(actorCtx, 'view', {
        kind: 'organization',
        id: input.orgId,
        orgId: input.orgId,
      });

      const { entity, limit, cursor, orgId, ...filters } = input;
      const rows = await listWork(orgId, entity, filters, limit, decodeWorkCursor(cursor));
      const { items, nextCursor } = pageWorkRows(rows, limit);
      return jsonResult({ entity, items, ...(nextCursor ? { nextCursor } : {}) });
    });

  registerOptionalTaskTool(
    server,
    'list_work',
    {
      title: 'List work',
      description:
        'Enumerate tasks, projects, programs, or initiatives matching exact criteria — everything assigned to someone, everything blocked, everything due this week, everything unfiled. Filters accept names as well as ids. Use find instead when you know roughly what something is called but not where it lives; this returns live rows, find reads a search index that trails writes.',
      inputSchema: listWorkInputSchema,
      outputSchema: listWorkOutputSchema,
      _meta: widgetMeta(WIDGET.workList),
      annotations: {
        title: 'List work',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execution: { taskSupport: 'optional' },
    },
    createTaskToolHandler<typeof listWorkInputSchema>(listWorkTool),
    listWorkTool,
  );

  for (const [type, name, title, widget] of SEMANTIC_READ_TOOLS) {
    server.registerTool(
      name,
      {
        title: `Get ${title}`,
        description: `Read one or more ${title.toLowerCase()} in full. Results render through Docket's ${title.toLowerCase()} view.`,
        inputSchema: { orgId: orgIdParam, refs: entityRefsSchema },
        outputSchema: entityReadOutputSchema,
        _meta: widgetMeta(widget),
        annotations: {
          title: `Get ${title}`,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        runTool(async () => jsonResult(await readEntities(ctx, input.orgId, type, input.refs))),
    );
  }

  server.registerTool(
    'get',
    {
      title: 'Get',
      description:
        'Legacy generic entity read. Prefer a type-specific `get_*` tool so Docket can render the right semantic view.',
      inputSchema: {
        orgId: orgIdParam,
        type: z
          .enum(READABLE_TYPES)
          .describe('What kind of entity the refs name. All refs in one call share a type.'),
        refs: entityRefsSchema.describe(
          `The entities to read. Projects, programs, initiatives, teams, and cycles also accept names. ${DESCRIPTOR_HINT}`,
        ),
      },
      outputSchema: entityReadOutputSchema,
      // Direct callers retain a stable endpoint, but a model should choose a view whose name and
      // widget carry the resource's semantics rather than a generic type switch.
      _meta: widgetMeta(WIDGET.entity, ['app']),
      annotations: {
        title: 'Get',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => jsonResult(await readEntities(ctx, input.orgId, input.type, input.refs))),
  );

  server.registerTool(
    'find',
    {
      title: 'Find',
      description:
        'Search a workspace by relevance across every kind of thing in it — tasks, projects, programs, initiatives, cycles, milestones, comments, updates, attachments, calendar events, agent sessions, teams, members, and labels. Ranked, so the best match comes first; use this when you know roughly what something is called but not exactly where it lives. To enumerate everything matching exact criteria instead, use list_work. Results come from a search index that trails writes by a moment, so something created seconds ago may not appear yet — use the id returned by the tool that created it rather than searching for it.',
      inputSchema: findInputSchema,
      outputSchema: findOutputSchema,
      annotations: {
        title: 'Find',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Membership in the org is the entry gate; per-row visibility (private tasks, grant-gated
        // subjects, activity the caller is not a recipient of) is enforced inside searchWorkspace.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:read');
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const result = await searchWorkspace({
          scope: 'org',
          caller: searchCallerFor(ctx),
          orgId: input.orgId,
          activeOrgId: input.orgId,
          params: {
            q: input.query,
            limit: input.limit,
            includeArchived: input.includeArchived,
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.kinds ? { kinds: input.kinds } : {}),
            ...(input.assigneeIds ? { assigneeIds: input.assigneeIds } : {}),
            ...(input.ownerIds ? { ownerIds: input.ownerIds } : {}),
            ...(input.labelIds ? { labelIds: input.labelIds } : {}),
            ...(input.statuses ? { statuses: input.statuses } : {}),
            ...(input.from ? { from: input.from } : {}),
            ...(input.to ? { to: input.to } : {}),
          },
        });
        return jsonResult({
          items: result.items.map(findItem).filter((item) => item !== null),
          facets: result.facets,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        });
      }),
  );
}
