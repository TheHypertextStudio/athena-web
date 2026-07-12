/**
 * `@docket/api` -- helpers for MCP task-augmented tools.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { z } from 'zod';

import { errorResult } from './result';

const DEFAULT_TASK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Wrap an existing tool body as an optional MCP task handler.
 *
 * @remarks
 * The task is created synchronously so the client receives a `CreateTaskResult` immediately.
 * The existing body then runs out-of-band and stores the normal `CallToolResult` for
 * `tasks/result`. If the task was cancelled before the body stores its result, the SDK task
 * store rejects the terminal-state overwrite and the background worker intentionally stops.
 */
export function createTaskToolHandler<InputArgs extends z.ZodRawShape>(
  run: (input: z.infer<z.ZodObject<InputArgs>>) => Promise<CallToolResult>,
): ToolTaskHandler<InputArgs> {
  const handler = {
    createTask: async (
      input: z.infer<z.ZodObject<InputArgs>>,
      extra: Parameters<NonNullable<ToolTaskHandler<InputArgs>['createTask']>>[1],
    ) => {
      const task = await extra.taskStore.createTask({
        ttl: extra.taskRequestedTtl ?? DEFAULT_TASK_TTL_MS,
        pollInterval: DEFAULT_POLL_INTERVAL_MS,
      });

      void Promise.resolve()
        .then(() => run(input))
        .then((result) =>
          extra.taskStore.storeTaskResult(
            task.taskId,
            result.isError ? 'failed' : 'completed',
            result,
          ),
        )
        .catch(async () => {
          try {
            await extra.taskStore.storeTaskResult(
              task.taskId,
              'failed',
              errorResult('Internal error'),
            );
          } catch {
            // The task may already have been cancelled; cancellation wins the race.
          }
        });

      return { task };
    },
    getTask: (
      _input: z.infer<z.ZodObject<InputArgs>>,
      extra: Parameters<NonNullable<ToolTaskHandler<InputArgs>['getTask']>>[1],
    ) => extra.taskStore.getTask(extra.taskId),
    getTaskResult: (
      _input: z.infer<z.ZodObject<InputArgs>>,
      extra: Parameters<NonNullable<ToolTaskHandler<InputArgs>['getTaskResult']>>[1],
    ) => extra.taskStore.getTaskResult(extra.taskId),
  };
  return handler as ToolTaskHandler<InputArgs>;
}
