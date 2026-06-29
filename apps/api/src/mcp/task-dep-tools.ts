import { db, taskDependency } from '@docket/db';
import type { McpRegistrar } from './catalog';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';

import { CycleError, NotFoundError, ValidationError } from '../error';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { loadTask, wouldCreateCycle } from './tools-shared';

/** Register add_task_dependency and remove_task_dependency on `server`. */
export function registerTaskDepTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'add_task_dependency',
    {
      title: 'Add task dependency',
      description:
        'Add a directed blocks edge (blocking → blocked); cross-project, acyclic, no self-loops.',
      inputSchema: {
        orgId: z.string().min(1),
        blockingTaskId: z.string().min(1),
        blockedTaskId: z.string().min(1),
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
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.blockingTaskId,
          orgId: input.orgId,
        });

        if (input.blockingTaskId === input.blockedTaskId) {
          throw new ValidationError(
            new z.ZodError([
              {
                code: 'custom',
                path: ['blockedTaskId'],
                message: 'A task cannot depend on itself',
                input: input.blockedTaskId,
              },
            ]),
          );
        }
        await loadTask(input.orgId, input.blockingTaskId);
        await loadTask(input.orgId, input.blockedTaskId);

        const existing = await db
          .select({ blockingTaskId: taskDependency.blockingTaskId })
          .from(taskDependency)
          .where(
            and(
              eq(taskDependency.blockingTaskId, input.blockingTaskId),
              eq(taskDependency.blockedTaskId, input.blockedTaskId),
              eq(taskDependency.organizationId, input.orgId),
            ),
          )
          .limit(1);
        if (existing[0]) return jsonResult({ alreadyLinked: true });

        if (await wouldCreateCycle(input.orgId, input.blockingTaskId, input.blockedTaskId)) {
          throw new CycleError();
        }

        await db.insert(taskDependency).values({
          blockingTaskId: input.blockingTaskId,
          blockedTaskId: input.blockedTaskId,
          organizationId: input.orgId,
        });
        return jsonResult({
          alreadyLinked: false,
          blockingTaskId: input.blockingTaskId,
          blockedTaskId: input.blockedTaskId,
        });
      }),
  );

  server.registerTool(
    'remove_task_dependency',
    {
      title: 'Remove task dependency',
      description: 'Drop a blocks edge between two tasks (removable from either endpoint).',
      inputSchema: {
        orgId: z.string().min(1),
        blockingTaskId: z.string().min(1),
        blockedTaskId: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.blockingTaskId,
          orgId: input.orgId,
        });
        await loadTask(input.orgId, input.blockingTaskId);

        const deleted = await db
          .delete(taskDependency)
          .where(
            and(
              eq(taskDependency.organizationId, input.orgId),
              or(
                and(
                  eq(taskDependency.blockingTaskId, input.blockingTaskId),
                  eq(taskDependency.blockedTaskId, input.blockedTaskId),
                ),
                and(
                  eq(taskDependency.blockingTaskId, input.blockedTaskId),
                  eq(taskDependency.blockedTaskId, input.blockingTaskId),
                ),
              ),
            ),
          )
          .returning();
        if (!deleted[0]) throw new NotFoundError('Dependency edge not found');
        return jsonResult({ removed: true });
      }),
  );
}
