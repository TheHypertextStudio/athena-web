import { dailyPlanItem, db, hub, task } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { registerOptionalTaskTool, type McpRegistrar } from './catalog';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { createTaskToolHandler } from './task-tools';
import { runEntityQuery, searchEntities } from './tools-shared';

const runViewInputSchema = {
  orgId: z.string().min(1),
  entity: z.enum(['task', 'project', 'program', 'initiative']),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
};

const runViewOutputSchema = {
  entity: z.enum(['task', 'project', 'program', 'initiative']),
  items: z.array(z.looseObject({ id: z.string() })),
  nextCursor: z.string().optional(),
};

/** Register run_view, search, and add_to_daily_plan on `server`. */
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
    'search',
    {
      title: 'Search',
      description: "Fused title search across the caller's tasks, projects, and programs.",
      inputSchema: {
        orgId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:read');
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const { results, nextCursor } = await searchEntities(
          input.orgId,
          input.query,
          input.limit,
          input.cursor,
        );
        return jsonResult({ query: input.query, results, nextCursor });
      }),
  );

  server.registerTool(
    'add_to_daily_plan',
    {
      title: 'Add to daily plan',
      description:
        "Pull a task into the caller's Hub Daily Plan for a date (Hub-scoped, cross-org).",
      inputSchema: {
        orgId: z.string().min(1),
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

        const hubRows = await db
          .select({ id: hub.id })
          .from(hub)
          .where(eq(hub.userId, ctx.userId))
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
