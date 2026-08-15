/**
 * `@docket/api` — the per-caller task-store view: ownership isolation, durable persistence,
 * mid-flight input, cancellation-intent recording, and TTL eviction.
 *
 * @remarks
 * `taskStoreForContext` wraps the `mcp_task` table with an ownership check keyed off
 * `principalKey`, so the bulk of this file is about that isolation: a caller reading, updating,
 * or listing another principal's task by id must fail exactly like the task never existed, never
 * with a permission-denied that would confirm it does. Everything runs against the same migrated
 * PGlite instance every other MCP suite uses (`getMigratedDb`), not a mock — `mcp_task` is a real
 * table exercised with real SQL, which is the whole point of replacing the old in-memory store.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { McpContext } from '../../src/mcp/auth';
import {
  requestTaskInput,
  sweepExpiredTasksForTesting,
  taskStoreForContext,
  waitForTaskInputResponse,
} from '../../src/mcp/task-store';
import { getMigratedDb } from '../support/db';
import { seedStatuses } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;

beforeAll(async () => {
  schema = await getMigratedDb();
});

function userCtx(userId: string): McpContext {
  return {
    principal: { kind: 'user', userId, userName: 'Ada', userEmail: `${userId}@example.com` },
    scopes: [],
  };
}

const REQUEST_ID = 'req-1';
const REQUEST = { method: 'tools/call', params: {} } as never;

async function readRow(taskId: string) {
  const [row] = await schema.db
    .select()
    .from(schema.mcpTask)
    .where(eq(schema.mcpTask.id, taskId))
    .limit(1);
  return row;
}

describe('taskStoreForContext', () => {
  let owner: ReturnType<typeof taskStoreForContext>;
  let other: ReturnType<typeof taskStoreForContext>;

  beforeEach(() => {
    owner = taskStoreForContext(userCtx(`owner-${Math.random().toString(36).slice(2)}`));
    other = taskStoreForContext(userCtx(`other-${Math.random().toString(36).slice(2)}`));
  });

  it('lets the owner read back a task it created', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    const read = await owner.getTask(created.taskId);
    expect(read?.taskId).toBe(created.taskId);
  });

  it('hides another principal’s task behind a null read, not an error', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(other.getTask(created.taskId)).resolves.toBeNull();
  });

  it('returns null for a task id that was never created', async () => {
    await expect(owner.getTask('nonexistent-task-id')).resolves.toBeNull();
  });

  it('refuses to store a result against another principal’s task', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(
      other.storeTaskResult(created.taskId, 'completed', { content: [] }),
    ).rejects.toThrow(`Task not found: ${created.taskId}`);
  });

  it('refuses to read a result for another principal’s task', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(other.getTaskResult(created.taskId)).rejects.toThrow(
      `Task not found: ${created.taskId}`,
    );
  });

  it('refuses to update the status of another principal’s task', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(other.updateTaskStatus(created.taskId, 'completed')).rejects.toThrow(
      `Task not found: ${created.taskId}`,
    );
  });

  it('refuses to cancel or answer input for another principal’s task', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(other.recordCancellationIntent(created.taskId)).rejects.toThrow(
      `Task not found: ${created.taskId}`,
    );
    await expect(other.resolveInputResponses(created.taskId, {})).rejects.toThrow(
      `Task not found: ${created.taskId}`,
    );
    await expect(other.getDetailedTask(created.taskId)).resolves.toBeNull();
  });

  it('lets the owner store and then read back a task result after completion', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await owner.storeTaskResult(created.taskId, 'completed', {
      content: [{ type: 'text', text: 'ok' }],
    });
    const result = await owner.getTaskResult(created.taskId);
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('lets the owner store and then read back a task error after a JSON-RPC failure', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await owner.storeTaskResult(created.taskId, 'failed', { code: -32603, message: 'boom' });
    const result = await owner.getTaskResult(created.taskId);
    expect(result).toMatchObject({ code: -32603, message: 'boom' });
    const detailed = await owner.getDetailedTask(created.taskId);
    expect(detailed?.status).toBe('failed');
    expect(detailed?.error).toMatchObject({ code: -32603, message: 'boom' });
  });

  it('refuses to store a second result for an already-terminal task', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await owner.storeTaskResult(created.taskId, 'completed', { content: [] });
    await expect(
      owner.storeTaskResult(created.taskId, 'completed', { content: [] }),
    ).rejects.toThrow(/terminal status/);
  });

  it('throws for a working task with no result stored yet', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(owner.getTaskResult(created.taskId)).rejects.toThrow('has no result stored');
  });

  it('refuses to transition an already-terminal task via updateTaskStatus', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await owner.storeTaskResult(created.taskId, 'completed', { content: [] });
    await expect(owner.updateTaskStatus(created.taskId, 'working')).rejects.toThrow(
      /terminal status/,
    );
  });

  it('carries a statusMessage through updateTaskStatus', async () => {
    const created = await owner.createTask({}, REQUEST_ID, REQUEST);
    await owner.updateTaskStatus(created.taskId, 'working', 'still going');
    const detailed = await owner.getDetailedTask(created.taskId);
    expect(detailed?.statusMessage).toBe('still going');
  });

  it('lists only the caller’s own tasks, oldest first, and excludes another principal’s', async () => {
    const mine1 = await owner.createTask({}, REQUEST_ID, REQUEST);
    const mine2 = await owner.createTask({}, REQUEST_ID, REQUEST);
    await other.createTask({}, REQUEST_ID, REQUEST);

    const page = await owner.listTasks();
    const ids = page.tasks.map((task) => task.taskId);
    expect(ids).toEqual(expect.arrayContaining([mine1.taskId, mine2.taskId]));
    expect(ids).not.toEqual(expect.arrayContaining([(await other.listTasks()).tasks[0]?.taskId]));
    expect(ids.indexOf(mine1.taskId)).toBeLessThan(ids.indexOf(mine2.taskId));
  });

  it('paginates past the first page using the returned cursor', async () => {
    const created: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const task = await owner.createTask({}, `req-${i}`, REQUEST);
      created.push(task.taskId);
    }

    const first = await owner.listTasks();
    expect(first.tasks).toHaveLength(10);
    expect(first.nextCursor).toBeDefined();

    const second = await owner.listTasks(first.nextCursor);
    expect(second.tasks.length).toBeGreaterThan(0);
    expect(second.tasks.map((t) => t.taskId)).not.toEqual(
      expect.arrayContaining(first.tasks.map((t) => t.taskId)),
    );
  });

  it('carries a nextCursor through a middle page when a third page still exists', async () => {
    for (let i = 0; i < 25; i += 1) {
      await owner.createTask({}, `many-${i}`, REQUEST);
    }
    const first = await owner.listTasks();
    const second = await owner.listTasks(first.nextCursor);
    expect(second.tasks).toHaveLength(10);
    expect(second.nextCursor).toBeDefined();

    const third = await owner.listTasks(second.nextCursor);
    expect(third.tasks.length).toBeGreaterThan(0);
  });

  it('omits nextCursor once the last page is reached', async () => {
    for (let i = 0; i < 3; i += 1) {
      await owner.createTask({}, `single-page-${i}`, REQUEST);
    }
    const page = await owner.listTasks();
    expect(page.nextCursor).toBeUndefined();
  });

  it('rejects an unknown pagination cursor', async () => {
    await owner.createTask({}, REQUEST_ID, REQUEST);
    await expect(owner.listTasks('not-a-real-cursor')).rejects.toThrow('Invalid cursor');
  });

  it('survives a fresh taskStoreForContext instance for the same principal — durability, not process memory', async () => {
    const ctx = userCtx(`durable-${Math.random().toString(36).slice(2)}`);
    const created = await taskStoreForContext(ctx).createTask({}, REQUEST_ID, REQUEST);
    // A brand-new store instance (as `server.ts` builds per request) still resolves the task —
    // proving state lives in Postgres, not a module-level object this instance happens to close
    // over.
    const reread = await taskStoreForContext(ctx).getTask(created.taskId);
    expect(reread?.taskId).toBe(created.taskId);
  });

  describe('mid-flight input (input_required / tasks/update)', () => {
    it('moves to input_required, resumes to working once answered, and wakes the waiter', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);

      const requested = await requestTaskInput(created.taskId, 'confirm', {
        method: 'elicitation/create',
        params: { message: 'Proceed?' },
      });
      expect(requested.status).toBe('input_required');
      expect(requested.inputRequests).toMatchObject({
        confirm: { method: 'elicitation/create' },
      });

      const waiter = waitForTaskInputResponse(created.taskId, 'confirm');
      const resolved = await owner.resolveInputResponses(created.taskId, {
        confirm: { action: 'accept' },
      });

      expect(resolved.applied).toEqual(['confirm']);
      expect(resolved.task.status).toBe('working');
      expect(resolved.task.inputRequests).toBeUndefined();
      await expect(waiter).resolves.toEqual({ action: 'accept' });
    });

    it('ignores responses for unknown or already-satisfied keys without error', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      await requestTaskInput(created.taskId, 'confirm', { method: 'elicitation/create' });

      const first = await owner.resolveInputResponses(created.taskId, { confirm: 'yes' });
      expect(first.applied).toEqual(['confirm']);

      // Same key again (already satisfied) plus one that was never requested.
      const second = await owner.resolveInputResponses(created.taskId, {
        confirm: 'yes-again',
        unknownKey: 'ignored',
      });
      expect(second.applied).toEqual([]);
      expect(second.task.status).toBe('working');
    });

    it('stays in input_required with only the unanswered keys once a subset is answered', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      await requestTaskInput(created.taskId, 'name', { method: 'elicitation/create' });
      await requestTaskInput(created.taskId, 'email', { method: 'elicitation/create' });

      const partial = await owner.resolveInputResponses(created.taskId, { name: 'Ada' });
      expect(partial.applied).toEqual(['name']);
      expect(partial.task.status).toBe('input_required');
      expect(partial.task.inputRequests).toMatchObject({ email: { method: 'elicitation/create' } });
      expect(partial.task.inputRequests).not.toHaveProperty('name');
    });

    it('refuses to reuse an input-request key once it has been used on that task', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      await requestTaskInput(created.taskId, 'confirm', { method: 'elicitation/create' });
      await owner.resolveInputResponses(created.taskId, { confirm: 'yes' });
      await expect(
        requestTaskInput(created.taskId, 'confirm', { method: 'elicitation/create' }),
      ).rejects.toThrow(/already used/);
    });

    it('refuses to request input for a task that already reached a terminal status', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      await owner.storeTaskResult(created.taskId, 'completed', { content: [] });
      await expect(
        requestTaskInput(created.taskId, 'confirm', { method: 'elicitation/create' }),
      ).rejects.toThrow(/terminal status/);
    });
  });

  describe('cancellation intent (tasks/cancel)', () => {
    it('cancels an in-flight task and reports it terminal', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      const cancelled = await owner.recordCancellationIntent(created.taskId);
      expect(cancelled.status).toBe('cancelled');
      const row = await readRow(created.taskId);
      expect(row?.cancellationRequested).toBe(true);
    });

    it('records cancellation intent even when the work already reached a non-cancelled terminal status', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      // The work wins the race and completes before the cancellation request is processed.
      await owner.storeTaskResult(created.taskId, 'completed', { content: [] });

      const afterCancel = await owner.recordCancellationIntent(created.taskId);
      // Status is unchanged — a completed task never flips to cancelled — but the intent itself
      // is still durably recorded, which is the entire point of the launch requirement.
      expect(afterCancel.status).toBe('completed');
      const row = await readRow(created.taskId);
      expect(row?.cancellationRequested).toBe(true);
      expect(row?.status).toBe('completed');
    });

    it('rejects a waiting input broker when its task is cancelled', async () => {
      const created = await owner.createTask({}, REQUEST_ID, REQUEST);
      await requestTaskInput(created.taskId, 'confirm', { method: 'elicitation/create' });
      const waiter = waitForTaskInputResponse(created.taskId, 'confirm');
      await owner.recordCancellationIntent(created.taskId);
      await expect(waiter).rejects.toThrow(/cancelled/);
    });
  });

  describe('TTL eviction', () => {
    it('does not retain a terminal task past its ttlMs', async () => {
      const created = await owner.createTask({ ttl: 20 }, REQUEST_ID, REQUEST);
      await owner.storeTaskResult(created.taskId, 'completed', { content: [] });
      // Still readable immediately after completion — the TTL clock starts at last-updated, not
      // creation, and 20ms has not elapsed yet.
      await expect(owner.getTask(created.taskId)).resolves.not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 40));
      // Eviction is lazy (runs on the next owner-scoped read, see task-store.ts's own remarks) —
      // this read is itself the sweep, not just an assertion on one that already happened.
      await expect(owner.getTask(created.taskId)).resolves.toBeNull();
    });

    it('the explicit sweep hook evicts an expired task without a read racing it first', async () => {
      const ctx = userCtx(`sweep-${Math.random().toString(36).slice(2)}`);
      const store = taskStoreForContext(ctx);
      const created = await store.createTask({ ttl: 20 }, REQUEST_ID, REQUEST);
      await store.storeTaskResult(created.taskId, 'completed', { content: [] });
      await new Promise((resolve) => setTimeout(resolve, 40));

      await sweepExpiredTasksForTesting(ctx.principal.kind === 'user' ? ctx.principal.userId : '');

      const row = await readRow(created.taskId);
      expect(row).toBeUndefined();
    });

    it('never evicts a non-terminal task no matter how long it has been working', async () => {
      const created = await owner.createTask({ ttl: 1 }, REQUEST_ID, REQUEST);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await expect(owner.getTask(created.taskId)).resolves.not.toBeNull();
    });
  });

  describe('MCP tasks only ever model in-progress/pending work, never finished Docket work', () => {
    it('lists exactly the one running MCP task alongside completed/cancelled/backlog Docket tasks in the same workspace', async () => {
      const slug = `ath22-${Math.random().toString(36).slice(2)}`;
      const [org] = await schema.db
        .insert(schema.organization)
        .values({ name: slug, slug, lifecycleState: 'active' })
        .returning({ id: schema.organization.id });
      const orgId = assertDefined(org).id;
      const statusId = await seedStatuses(schema.db, schema, orgId);
      const [team] = await schema.db
        .insert(schema.team)
        .values({ organizationId: orgId, name: 'General', key: 'GEN' })
        .returning({ id: schema.team.id });
      const teamId = assertDefined(team).id;

      // Finished or non-executing Docket work: none of this is a task-store row, by
      // construction (mcp_task rows are only ever created by task-store.ts::createTask, called
      // only from a task-augmented tools/call — nothing here inserts into that table). This test
      // proves the listing is actually empty of them, not just that the design "should" exclude
      // them.
      await schema.db.insert(schema.task).values([
        {
          organizationId: orgId,
          teamId,
          title: 'Completed work',
          state: 'done',
          statusId: statusId('task', 'done'),
          completedAt: new Date(),
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Cancelled work',
          state: 'canceled',
          statusId: statusId('task', 'canceled'),
          canceledAt: new Date(),
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Backlog work',
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        },
      ]);

      // The one thing that SHOULD show up: a running MCP task for this same principal.
      const running = await owner.createTask({}, REQUEST_ID, REQUEST);

      const page = await owner.listTasks();
      expect(page.tasks.map((t) => t.taskId)).toEqual([running.taskId]);
      expect(page.tasks[0]?.status).toBe('working');

      // Direct confirmation the seeded Docket task rows really landed in the `task` table and
      // not `mcp_task` — the isolation above isn't vacuously true because the seed silently
      // failed.
      const docketTaskRows = await schema.db
        .select({ id: schema.task.id, state: schema.task.state })
        .from(schema.task)
        .where(eq(schema.task.organizationId, orgId));
      expect(docketTaskRows).toHaveLength(3);
      expect(docketTaskRows.map((r) => r.state).sort()).toEqual(['backlog', 'canceled', 'done']);
    });
  });
});
