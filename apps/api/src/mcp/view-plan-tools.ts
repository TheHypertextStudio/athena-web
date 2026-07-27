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

  server.registerTool(
    'get',
    {
      title: 'Get',
      description:
        'Read one or more entities in full — a task with its dependencies and subtasks, a project with its milestones and latest update, a session with its whole activity stream. Pass several ids to fetch them in one call. Anything you cannot see is reported in `missing` rather than failing the batch, so one unreadable id never costs you the rest.',
      inputSchema: {
        orgId: orgIdParam,
        type: z
          .enum(READABLE_TYPES)
          .describe('What kind of entity the refs name. All refs in one call share a type.'),
        refs: z
          .array(z.string().min(1))
          .min(1)
          .max(50)
          .describe(
            `The entities to read. Projects, programs, initiatives, teams, and cycles also accept names. ${DESCRIPTOR_HINT}`,
          ),
      },
      outputSchema: {
        items: z.array(z.looseObject({ id: z.string() })),
        missing: z.array(z.object({ ref: z.string(), reason: z.string() })),
      },
      _meta: widgetMeta(WIDGET.entity),
      annotations: {
        title: 'Get',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Loop-invariant: the type is fixed for the batch, so the descriptor kind is looked up once.
        const kind = NAMEABLE[input.type];
        // Concurrent, but still authorized per entity — `readEntity` runs the same `view` gate a
        // single resource read runs, so batching shares the waiting, never the permission check.
        const settled = await Promise.all(
          input.refs.map(async (ref) => {
            try {
              const id = kind ? await resolveDescriptor(input.orgId, kind, ref, 'refs') : ref;
              return {
                ok: true as const,
                value: await readEntity(ctx, input.orgId, input.type, id),
              };
            } catch (err) {
              return {
                ok: false as const,
                ref,
                reason: err instanceof ApiError ? err.code : 'internal',
              };
            }
          }),
        );
        return jsonResult({
          items: settled.filter((r) => r.ok).map((r) => r.value),
          missing: settled.filter((r) => !r.ok).map(({ ref, reason }) => ({ ref, reason })),
        });
      }),
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
