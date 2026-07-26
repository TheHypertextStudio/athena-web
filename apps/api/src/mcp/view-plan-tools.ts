import { dailyPlanItem, db, hub, task } from '@docket/db';
import { SearchDocumentKind, type SearchResult, type SearchRoute } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { type SearchCaller, searchWorkspace } from '../search/query';
import type { McpContext } from './auth';
import { registerOptionalTaskTool, type McpRegistrar } from './catalog';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { createTaskToolHandler } from './task-tools';
import { orgIdParam, runEntityQuery } from './tools-shared';

const runViewInputSchema = {
  orgId: orgIdParam,
  entity: z.enum(['task', 'project', 'program', 'initiative']),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
};

const runViewOutputSchema = {
  entity: z.enum(['task', 'project', 'program', 'initiative']),
  items: z.array(z.looseObject({ id: z.string() })),
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

/** Register run_view, find, and add_to_daily_plan on `server`. */
export function registerViewPlanTools(server: McpRegistrar, ctx: McpContext): void {
  const runView = (input: z.infer<z.ZodObject<typeof runViewInputSchema>>) =>
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

      const { items, nextCursor } = await runEntityQuery(
        input.orgId,
        input.entity,
        input.limit,
        input.cursor,
      );
      return jsonResult({ entity: input.entity, items, nextCursor });
    });

  registerOptionalTaskTool(
    server,
    'run_view',
    {
      title: 'Run view',
      description:
        'Run an ad-hoc, permission-filtered query over tasks/projects/programs/initiatives.',
      inputSchema: runViewInputSchema,
      outputSchema: runViewOutputSchema,
      annotations: {
        title: 'Run view',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      execution: { taskSupport: 'optional' },
    },
    createTaskToolHandler<typeof runViewInputSchema>(runView),
    runView,
  );

  server.registerTool(
    'find',
    {
      title: 'Find',
      description:
        'Search a workspace by relevance across every kind of thing in it — tasks, projects, programs, initiatives, cycles, milestones, comments, updates, attachments, calendar events, agent sessions, teams, members, and labels. Ranked, so the best match comes first; use this when you know roughly what something is called but not exactly where it lives. To enumerate everything matching exact criteria instead, use run_view. Results come from a search index that trails writes by a moment, so something created seconds ago may not appear yet — use the id returned by the tool that created it rather than searching for it.',
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

  server.registerTool(
    'add_to_daily_plan',
    {
      title: 'Add to daily plan',
      description:
        "Pull a task into the caller's Hub Daily Plan for a date (Hub-scoped, cross-org).",
      inputSchema: {
        orgId: orgIdParam,
        taskId: z.string().min(1),
        date: z.iso.date(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Hub-scoped: authorized by `sub` ownership of the Hub plus org membership.
        // `resolveActor` proves the caller is a human Actor in the org (membership IS the
        // scope) before the ref task is verified to live there.
        await scopedActor(ctx, input.orgId, 'work:write');

        // The daily plan is a personal (per-user Hub) surface; an agent principal has
        // no Hub, so it cannot plan into one (existence-hiding NotFound).
        if (ctx.principal.kind === 'agent') throw new NotFoundError('Hub not found');
        const hubRows = await db
          .select({ id: hub.id })
          .from(hub)
          .where(eq(hub.userId, ctx.principal.userId))
          .limit(1);
        const hubRow = hubRows[0];
        if (!hubRow) throw new NotFoundError('Hub not found');

        const taskRows = await db
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .limit(1);
        if (!taskRows[0]) throw new NotFoundError('Task not found');

        // Idempotent: re-adding the same task on the same date returns the existing item.
        const existing = await db
          .select({ id: dailyPlanItem.id, status: dailyPlanItem.status })
          .from(dailyPlanItem)
          .where(
            and(
              eq(dailyPlanItem.hubId, hubRow.id),
              eq(dailyPlanItem.refTaskId, input.taskId),
              eq(dailyPlanItem.date, input.date),
            ),
          )
          .limit(1);
        if (existing[0]) {
          return jsonResult({ id: existing[0].id, status: existing[0].status, created: false });
        }

        const inserted = await db
          .insert(dailyPlanItem)
          .values({
            hubId: hubRow.id,
            refOrganizationId: input.orgId,
            refTaskId: input.taskId,
            date: input.date,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('daily plan item insert returned no row');
        return jsonResult({ id: row.id, status: row.status, created: true });
      }),
  );
}
