/**
 * `@docket/api` -- helpers for MCP task-augmented tools.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { z } from 'zod';

import { MCP_INTERNAL_ERROR, type McpTaskInputRequest } from '@docket/types';

import { requestTaskInput, waitForTaskInputResponse } from './task-store';

const DEFAULT_TASK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * What a task-tool body uses to ask the client for input mid-execution.
 *
 * @remarks
 * Backs the extension's `input_required`/`tasks/update` mechanism (mcp-tasks-draft.md "Task
 * Update Requests"): calling this moves the task to `input_required` with `request` published
 * under `key`, and the returned promise does not resolve until a `tasks/update` answers that key
 * (see `waitForTaskInputResponse`'s cross-instance caveat).
 */
export interface TaskInputBroker {
  requestInput(key: string, request: McpTaskInputRequest): Promise<unknown>;
}

/**
 * Wrap an existing tool body as an optional MCP task handler.
 *
 * @remarks
 * The task is created synchronously so the client receives a `CreateTaskResult` immediately. The
 * existing body then runs out-of-band and stores the normal `CallToolResult` for `tasks/get`.
 *
 * Every settled `CallToolResult` — including one with `isError: true` — stores as `completed`:
 * per the committed spec ("Task Execution Errors"), `failed` is reserved for a genuine JSON-RPC
 * protocol error surfacing while the request executes, never for a tool-level failure the body
 * already reported through the ordinary `isError` contract. Only `run` itself throwing produces
 * `failed`, with a JSON-RPC-shaped `error` (not a `CallToolResult`) as the spec requires.
 *
 * If the task was cancelled before the body stores its result, the task store rejects the
 * terminal-state overwrite and the background worker intentionally stops — cancellation intent
 * itself is recorded durably by `tasks/cancel` (`task-protocol.ts`), independent of this race.
 */
export function createTaskToolHandler<InputArgs extends z.ZodRawShape>(
  run: (input: z.infer<z.ZodObject<InputArgs>>, broker: TaskInputBroker) => Promise<CallToolResult>,
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

      const broker: TaskInputBroker = {
        requestInput: async (key, request) => {
          await requestTaskInput(task.taskId, key, request);
          return waitForTaskInputResponse(task.taskId, key);
        },
      };

      void Promise.resolve()
        .then(() => run(input, broker))
        .then((result) => extra.taskStore.storeTaskResult(task.taskId, 'completed', result))
        .catch(async (err: unknown) => {
          try {
            await extra.taskStore.storeTaskResult(task.taskId, 'failed', {
              code: MCP_INTERNAL_ERROR,
              message: err instanceof Error ? err.message : 'Internal error',
            });
          } catch {
            // The task already reached a terminal status (e.g. `tasks/cancel` won the race); that
            // durably recorded the cancellation intent itself, so there is nothing left to persist.
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
