/**
 * `@docket/api` — `createTaskToolHandler`'s own `getTask`/`getTaskResult` delegation.
 *
 * @remarks
 * The end-to-end `createTask` → background completion → `tasks/get` flow is already covered live
 * through `task-protocol.test.ts` and `mcp-surface.test.ts` (real task creation via `tools/call`).
 * This file exists for the two thin pass-through members of the returned `ToolTaskHandler` that
 * nothing in this codebase's current architecture calls over the wire — `task-protocol.ts`
 * answers `tasks/get`/`tasks/result` straight off the task store, never through a tool's own
 * handler — but which the SDK's `ToolTaskHandler` type still requires `createTaskToolHandler` to
 * implement, so they are exercised directly here instead of left dark.
 */
import type { ToolTaskHandler } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { Task } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createTaskToolHandler } from '../../src/mcp/task-tools';

const inputShape = { name: z.string() };
const InputSchema = z.object(inputShape);

describe('createTaskToolHandler', () => {
  it('delegates getTask straight to the bound task store', async () => {
    const handler = createTaskToolHandler<typeof inputShape>(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    const task: Task = {
      taskId: 't-1',
      status: 'working',
      ttl: null,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    const getTask = vi.fn().mockResolvedValue(task);
    const extra = {
      taskId: 't-1',
      taskStore: { getTask, getTaskResult: vi.fn() },
    } as unknown as Parameters<NonNullable<ToolTaskHandler<typeof inputShape>['getTask']>>[1];

    const result = await handler.getTask(InputSchema.parse({ name: 'x' }), extra);
    expect(result).toBe(task);
    expect(getTask).toHaveBeenCalledWith('t-1');
  });

  it('delegates getTaskResult straight to the bound task store', async () => {
    const handler = createTaskToolHandler<typeof inputShape>(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    const storedResult = { content: [{ type: 'text', text: 'done' }] };
    const getTaskResult = vi.fn().mockResolvedValue(storedResult);
    const extra = {
      taskId: 't-2',
      taskStore: { getTask: vi.fn(), getTaskResult },
    } as unknown as Parameters<NonNullable<ToolTaskHandler<typeof inputShape>['getTaskResult']>>[1];

    const result = await handler.getTaskResult(InputSchema.parse({ name: 'x' }), extra);
    expect(result).toBe(storedResult);
    expect(getTaskResult).toHaveBeenCalledWith('t-2');
  });
});
