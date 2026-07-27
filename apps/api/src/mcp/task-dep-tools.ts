import { db, taskDependency } from '@docket/db';
import { TaskId } from '@docket/types';
import type { McpRegistrar } from './catalog';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';

import { CycleError, NotFoundError, ValidationError } from '../error';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { loadTask, orgIdParam, wouldCreateCycle } from './tools-shared';

/** Register add_task_dependency and remove_task_dependency on `server`. */
export function registerTaskDepTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'add_task_dependency',
    {
      title: 'Add task dependency',
      description:
        'Record that one task blocks another. Direction matters: the blocking task must finish before the blocked one can. Edges may cross projects, but a cycle or a self-loop is refused.',
      inputSchema: {
        orgId: orgIdParam,
        blockingTaskId: z.string().min(1).describe('The task that must finish first, by id.'),
        blockedTaskId: z.string().min(1).describe('The task that is waiting, by id.'),
      },
      outputSchema: {
        blockingTaskId: TaskId,
        blockedTaskId: TaskId,
        alreadyLinked: z.boolean().describe('True when the edge already existed.'),
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
        // Same shape on both branches: a caller should not have to switch on whether the edge
        // happened to exist already.
        if (existing[0]) {
          return jsonResult({
            blockingTaskId: input.blockingTaskId,
            blockedTaskId: input.blockedTaskId,
            alreadyLinked: true,
          });
        }

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
      description:
        'Remove a blocks edge between two tasks. Either endpoint may ask, and naming the pair in either order works.',
      inputSchema: {
        orgId: orgIdParam,
        blockingTaskId: z.string().min(1).describe('One end of the edge, by id.'),
        blockedTaskId: z.string().min(1).describe('The other end, by id.'),
      },
      outputSchema: { removed: z.boolean().describe('True once the edge is gone.') },
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
