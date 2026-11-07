import { z } from 'zod';

import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { errorResult, jsonResult, runTool } from './result';
import { requireScope } from './scope';
import { TimeTimelineQuery } from '../contracts/time';
import { measureHumanProgress } from '../time/commitment-progress';
import { getTimeTimeline, listTimeCategories } from '../time/service';

function registerTimeGoalCategories(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'time_goal_categories',
    {
      title: 'List time categories',
      description: 'List the person’s time categories for choosing a time-goal filter.',
      inputSchema: {},
      outputSchema: {
        categories: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            parentId: z.string().nullable(),
            archived: z.boolean(),
          }),
        ),
        truncated: z.boolean(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () =>
      runTool(async () => {
        requireScope(ctx.scopes, 'time:progress');
        if (ctx.principal.kind !== 'user')
          return errorResult('Time categories belong to a person.');
        const categories = await listTimeCategories(ctx.principal.userId);
        return jsonResult({
          categories: categories.slice(0, 500).map(({ id, name, parentId, archivedAt }) => ({
            id,
            name,
            parentId,
            archived: archivedAt !== null,
          })),
          truncated: categories.length > 500,
        });
      }),
  );
}

/** Register personal time-goal queries. */
export function registerTimeGoalTool(server: McpRegistrar, ctx: McpContext): void {
  registerTimeGoalCategories(server, ctx);
  server.registerTool(
    'time_goal_progress',
    {
      title: 'Check time goal progress',
      description:
        'Measure distinct human tracked time in a bounded period, optionally filtered by task, project, workspace, or personal category. This is tracked time, not proof of attention.',
      inputSchema: {
        start: z.iso.datetime(),
        end: z.iso.datetime(),
        targetMs: z.number().int().positive().max(2_678_400_000),
        taskId: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        workspaceId: z.string().min(1).optional(),
        categoryId: z.string().min(1).optional(),
        includeManual: z.boolean().optional(),
      },
      outputSchema: {
        elapsedMs: z.number().int().nonnegative(),
        targetMs: z.number().int().positive(),
        satisfied: z.boolean(),
        observedAt: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (args: {
      start: string;
      end: string;
      targetMs: number;
      taskId?: string | undefined;
      projectId?: string | undefined;
      workspaceId?: string | undefined;
      categoryId?: string | undefined;
      includeManual?: boolean | undefined;
    }) =>
      runTool(async () => {
        requireScope(ctx.scopes, 'time:progress');
        if (ctx.principal.kind !== 'user') return errorResult('Time progress belongs to a person.');
        const parsed = TimeTimelineQuery.safeParse({
          start: args.start,
          end: args.end,
          ...(args.taskId ? { taskId: args.taskId } : {}),
          ...(args.projectId ? { projectId: args.projectId } : {}),
          ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
          ...(args.categoryId ? { categoryId: args.categoryId } : {}),
        });
        if (!parsed.success || Date.parse(args.end) - Date.parse(args.start) > 31 * 86_400_000) {
          return errorResult('Choose a valid time window of at most 31 days.');
        }
        const now = Date.now();
        const records = await getTimeTimeline(ctx.principal.userId, parsed.data);
        const elapsedMs = measureHumanProgress(
          records.flatMap((record) => record.intervals),
          {
            start: Date.parse(args.start),
            end: Date.parse(args.end),
            now,
            userId: ctx.principal.userId,
            includeManual: args.includeManual === true,
          },
        );
        return jsonResult({
          elapsedMs,
          targetMs: args.targetMs,
          satisfied: elapsedMs >= args.targetMs,
          observedAt: new Date(now).toISOString(),
        });
      }),
  );
}
