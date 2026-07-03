/**
 * `@docket/api` -- MCP task storage with caller ownership checks.
 */
import { InMemoryTaskStore, type TaskStore } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { CreateTaskOptions } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { Request, RequestId, Result, Task } from '@modelcontextprotocol/sdk/types.js';

import type { McpContext } from './auth';
import { principalKey } from './principal';

const sharedStore = new InMemoryTaskStore();
const taskOwners = new Map<string, string>();

function ownerKey(ctx: McpContext): string {
  return principalKey(ctx);
}

function notFound(taskId: string): Error {
  return new Error(`Task not found: ${taskId}`);
}

/** Build a task store view bound to one authenticated MCP caller. */
export function taskStoreForContext(ctx: McpContext): TaskStore {
  const owner = ownerKey(ctx);
  const assertOwner = async (taskId: string, sessionId?: string): Promise<Task> => {
    const task = await sharedStore.getTask(taskId, sessionId);
    if (!task || taskOwners.get(taskId) !== owner) throw notFound(taskId);
    return task;
  };

  return {
    createTask: async (
      taskParams: CreateTaskOptions,
      requestId: RequestId,
      request: Request,
      sessionId?: string,
    ) => {
      const task = await sharedStore.createTask(taskParams, requestId, request, sessionId);
      taskOwners.set(task.taskId, owner);
      return task;
    },
    getTask: async (taskId: string, sessionId?: string) => {
      try {
        return await assertOwner(taskId, sessionId);
      } catch {
        return null;
      }
    },
    storeTaskResult: async (
      taskId: string,
      status: 'completed' | 'failed',
      result: Result,
      sessionId?: string,
    ) => {
      await assertOwner(taskId, sessionId);
      await sharedStore.storeTaskResult(taskId, status, result, sessionId);
    },
    getTaskResult: async (taskId: string, sessionId?: string) => {
      await assertOwner(taskId, sessionId);
      return sharedStore.getTaskResult(taskId, sessionId);
    },
    updateTaskStatus: async (
      taskId: string,
      status: Task['status'],
      statusMessage?: string,
      sessionId?: string,
    ) => {
      await assertOwner(taskId, sessionId);
      await sharedStore.updateTaskStatus(taskId, status, statusMessage, sessionId);
    },
    listTasks: async (cursor?: string) => {
      const all = sharedStore
        .getAllTasks()
        .filter((task) => taskOwners.get(task.taskId) === owner)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId));

      if (!cursor) {
        return {
          tasks: all.slice(0, 10),
          nextCursor: all.length > 10 ? all[9]?.taskId : undefined,
        };
      }

      const index = all.findIndex((task) => task.taskId === cursor);
      if (index < 0) throw new Error(`Invalid cursor: ${cursor}`);
      const page = all.slice(index + 1, index + 11);
      return {
        tasks: page,
        nextCursor: index + 11 < all.length ? page[page.length - 1]?.taskId : undefined,
      };
    },
  };
}
