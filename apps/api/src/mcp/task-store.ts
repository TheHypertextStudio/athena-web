/**
 * `@docket/api` -- MCP task storage: durable, owner-scoped, and notification-aware.
 *
 * @remarks
 * Backed by the `mcp_task` table (`packages/db/src/schema/mcp-tasks.ts`) rather than process
 * memory, because `server.ts` builds a fresh, stateless `McpServer` per request (mcp-surface.md
 * §2.3) — a task created on one request must still resolve on a later one, and must survive an
 * instance restart, which nothing held only in a module-level `Map` can do.
 *
 * Every entry point reachable from an authenticated MCP request is owner-scoped: a lookup,
 * update, cancel, or listen for a task id that exists but belongs to a different principal
 * reports "not found," never "forbidden" — the existence-hiding posture the rest of the MCP
 * surface uses, and required by the spec's own security section (task ids are unguessable bearer
 * tokens, not access-controlled resources). The module-level `requestTaskInput`/
 * `waitForTaskInputResponse` free functions below are the one exception: they are called only
 * from the trusted background worker that owns a task's execution
 * (`apps/api/src/mcp/task-tools.ts`), which never receives another principal's task id, so an
 * owner check there would be redundant, not protective.
 *
 * This module implements the extension's mid-flight input mechanism end to end
 * (`requestTaskInput`/`waitForTaskInputResponse` for the running task body, `resolveInputResponses`
 * for the client's `tasks/update`) and pushes `notifications/tasks` on every status transition to
 * sessions that opted in via `subscriptions/listen`, so `task-tools.ts`/`task-protocol.ts` never
 * touch SQL directly.
 */
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { db, mcpTask } from '@docket/db';
import type { TaskStore } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { CreateTaskOptions } from '@modelcontextprotocol/sdk/experimental/tasks';
import type { Request, RequestId, Result, Task } from '@modelcontextprotocol/sdk/types.js';
import {
  isTerminalTaskStatus,
  type McpDetailedTask,
  type McpTaskInputRequest,
  type McpTaskInputRequests,
  type McpTaskInputResponses,
} from '@docket/integrations/mcp-tasks-contract';

import type { McpContext } from './auth';
import { notifyTaskStatus } from './notify';
import { principalKey } from './principal';
import { taskListenerUri } from './task-listener-uri';

type TaskRow = typeof mcpTask.$inferSelect;

function ownerKey(ctx: McpContext): string {
  return principalKey(ctx);
}

function notFound(taskId: string): Error {
  return new Error(`Task not found: ${taskId}`);
}

export { taskListenerUri };

/** Project a stored row to the shape the `@modelcontextprotocol/sdk` `TaskStore` interface uses. */
function toSdkTask(row: TaskRow): Task {
  return {
    taskId: row.id,
    status: row.status,
    ...(row.statusMessage ? { statusMessage: row.statusMessage } : {}),
    createdAt: row.createdAt.toISOString(),
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    ttl: row.ttlMs ?? null,
    ...(row.pollIntervalMs != null ? { pollInterval: row.pollIntervalMs } : {}),
  };
}

/**
 * Project a stored row to the spec-literal `DetailedTask` shape (`ttlMs`/`pollIntervalMs`, inline
 * `result`/`error`/`inputRequests`) used by the custom `tasks/get`, `tasks/update`, `tasks/cancel`,
 * and `notifications/tasks` handlers in `task-protocol.ts`.
 */
export function toDetailedTask(row: TaskRow): McpDetailedTask {
  return {
    taskId: row.id,
    status: row.status,
    ...(row.statusMessage ? { statusMessage: row.statusMessage } : {}),
    createdAt: row.createdAt.toISOString(),
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
    ttlMs: row.ttlMs ?? null,
    ...(row.pollIntervalMs != null ? { pollIntervalMs: row.pollIntervalMs } : {}),
    ...(row.status === 'input_required' && row.inputRequests
      ? { inputRequests: row.inputRequests as McpTaskInputRequests }
      : {}),
    ...(row.status === 'completed' && row.result ? { result: row.result } : {}),
    ...(row.status === 'failed' && row.error ? { error: row.error } : {}),
  };
}

/** SQL predicate for "terminal, TTL-bound, and past its TTL as of now" — the eviction rule. */
function expiredPredicate() {
  return sql`${mcpTask.ttlMs} is not null
    and ${mcpTask.status} in ('completed', 'failed', 'cancelled')
    and (extract(epoch from (now() - ${mcpTask.lastUpdatedAt})) * 1000) > ${mcpTask.ttlMs}`;
}

/**
 * Delete every expired task belonging to one owner before a read, so an evicted task is reported
 * as not-found rather than momentarily still readable.
 *
 * @remarks
 * Called inline on every owner-scoped read instead of on a timer: the stateless-per-request
 * transport means there is no long-lived process to hold a timer, so "check on access" is the
 * only sweep guaranteed to run. {@link sweepExpiredTasksForTesting} exposes the same sweep for a
 * test that wants to assert eviction without waiting on a subsequent read.
 */
async function evictExpired(owner: string): Promise<void> {
  await db.delete(mcpTask).where(and(eq(mcpTask.ownerKey, owner), expiredPredicate()));
}

/** Test-only hook: run the TTL eviction sweep for one owner directly. */
export async function sweepExpiredTasksForTesting(owner: string): Promise<void> {
  await evictExpired(owner);
}

async function fetchOwnedRow(taskId: string, owner: string): Promise<TaskRow | undefined> {
  await evictExpired(owner);
  const [row] = await db
    .select()
    .from(mcpTask)
    .where(and(eq(mcpTask.id, taskId), eq(mcpTask.ownerKey, owner)))
    .limit(1);
  return row;
}

/**
 * Apply a patch and push `notifications/tasks`, with no ownership check — every caller has
 * already established the right to write (an owner check upstream, or trusted background-worker
 * code operating on a task id it just minted itself).
 */
async function persistAndNotify(taskId: string, patch: Partial<TaskRow>): Promise<TaskRow> {
  const [row] = await db
    .update(mcpTask)
    // `now()` rather than a JS `Date`: this column feeds `expiredPredicate`'s server-side
    // `now() - last_updated_at` arithmetic, so it must come from the same clock `now()` reads
    // there — a client-clock `Date` landed here once and produced an 8-hour-off `last_updated_at`
    // relative to `created_at`'s own `now()`-sourced default, which silently broke TTL eviction.
    .set({ ...patch, lastUpdatedAt: sql`now()` })
    .where(eq(mcpTask.id, taskId))
    .returning();
  if (!row) throw notFound(taskId);
  // Best-effort: a missed push is a hint lost, never data lost — tasks/get still resolves.
  await notifyTaskStatus(taskId, toDetailedTask(row)).catch(() => undefined);
  return row;
}

/** In-process wake-up for a `tasks/update` response landing on the instance awaiting it. */
interface InputWaiter {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}
const inputWaiters = new Map<string, InputWaiter>();

function waiterKey(taskId: string, key: string): string {
  return `${taskId} ${key}`;
}

/**
 * Move a task to `input_required`, publishing one new outstanding request under `key`.
 *
 * @remarks
 * Called from `task-tools.ts`'s running task body — the trusted background worker for a task id
 * it just created — never from an inbound client request, so this is not owner-scoped; see the
 * module remarks.
 */
export async function requestTaskInput(
  taskId: string,
  key: string,
  request: McpTaskInputRequest,
): Promise<McpDetailedTask> {
  const [row] = await db.select().from(mcpTask).where(eq(mcpTask.id, taskId)).limit(1);
  if (!row) throw notFound(taskId);
  if (isTerminalTaskStatus(row.status)) {
    throw new Error(`Cannot request input for task ${taskId} in terminal status '${row.status}'.`);
  }
  const resolved = row.resolvedInputKeys ?? [];
  if (resolved.includes(key)) {
    throw new Error(`Input-request key '${key}' was already used on task ${taskId}.`);
  }
  const existing = row.inputRequests ?? {};
  const updated = await persistAndNotify(taskId, {
    status: 'input_required',
    inputRequests: { ...existing, [key]: request },
  });
  return toDetailedTask(updated);
}

/**
 * Wait, in-process, for a `tasks/update` to answer `key` on this task.
 *
 * @remarks
 * A local optimization only: the authoritative record is the `input_requests`/
 * `resolved_input_keys` columns, which `tasks/get` reads regardless of which instance answered.
 * In a multi-instance deployment where the answering `tasks/update` lands on a different instance
 * than the one running the task body, this promise does not resolve on its own — the running
 * instance's task body stays parked until the process that holds it is recycled. Documented here
 * rather than solved: the dev-stack this launch item is verified against is single-instance, and
 * closing the cross-instance case would need a second push channel (e.g. piggybacking on the
 * `mcp_notify` LISTEN/NOTIFY channel `notify.ts` already owns) that is out of scope for this pass.
 */
export function waitForTaskInputResponse(taskId: string, key: string): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    inputWaiters.set(waiterKey(taskId, key), { resolve, reject });
  });
}

/**
 * A task-store view bound to one authenticated MCP caller, exposing both the SDK's `TaskStore`
 * contract and Docket's extensions for mid-flight input and cancellation-intent recording.
 */
export interface DocketTaskStore extends TaskStore {
  /** Apply `tasks/update`'s `inputResponses`, resuming to `working` once none remain outstanding. */
  resolveInputResponses(
    taskId: string,
    responses: McpTaskInputResponses,
  ): Promise<{ readonly applied: readonly string[]; readonly task: McpDetailedTask }>;
  /** Durably record that `tasks/cancel` was received, independent of the eventual terminal status. */
  recordCancellationIntent(taskId: string): Promise<McpDetailedTask>;
  /** Read the full spec-shaped task, including any inline `result`/`error`/`inputRequests`. */
  getDetailedTask(taskId: string): Promise<McpDetailedTask | null>;
}

/** Build a task store view bound to one authenticated MCP caller. */
export function taskStoreForContext(ctx: McpContext, sessionId?: string | null): DocketTaskStore {
  const owner = ownerKey(ctx);
  const boundSession = sessionId ?? undefined;

  const assertOwnedRow = async (taskId: string): Promise<TaskRow> => {
    const row = await fetchOwnedRow(taskId, owner);
    if (!row) throw notFound(taskId);
    return row;
  };

  return {
    createTask: async (
      taskParams: CreateTaskOptions,
      _requestId: RequestId,
      _request: Request,
      sessionIdParam?: string,
    ) => {
      const [row] = await db
        .insert(mcpTask)
        .values({
          id: crypto.randomUUID(),
          ownerKey: owner,
          sessionId: sessionIdParam ?? boundSession ?? null,
          status: 'working',
          ttlMs: taskParams.ttl ?? null,
          pollIntervalMs: taskParams.pollInterval ?? null,
        })
        .returning();
      if (!row) throw new Error('Failed to create task: insert returned no row');
      return toSdkTask(row);
    },

    getTask: async (taskId: string) => {
      const row = await fetchOwnedRow(taskId, owner);
      return row ? toSdkTask(row) : null;
    },

    getDetailedTask: async (taskId: string) => {
      const row = await fetchOwnedRow(taskId, owner);
      return row ? toDetailedTask(row) : null;
    },

    storeTaskResult: async (taskId: string, status: 'completed' | 'failed', result: Result) => {
      const row = await assertOwnedRow(taskId);
      if (isTerminalTaskStatus(row.status)) {
        throw new Error(
          `Cannot store result for task ${taskId} in terminal status '${row.status}'. Task results can only be stored once.`,
        );
      }
      await persistAndNotify(taskId, {
        status,
        ...(status === 'completed' ? { result: result } : { error: result }),
      });
    },

    getTaskResult: async (taskId: string) => {
      const row = await assertOwnedRow(taskId);
      if (row.status === 'completed' && row.result) return row.result;
      if (row.status === 'failed' && row.error) return row.error;
      throw new Error(`Task ${taskId} has no result stored`);
    },

    updateTaskStatus: async (taskId: string, status: Task['status'], statusMessage?: string) => {
      const row = await assertOwnedRow(taskId);
      if (isTerminalTaskStatus(row.status)) {
        throw new Error(
          `Cannot update task ${taskId} from terminal status '${row.status}' to '${status}'. Terminal states (completed, failed, cancelled) cannot transition to other states.`,
        );
      }
      await persistAndNotify(taskId, { status, ...(statusMessage ? { statusMessage } : {}) });
    },

    resolveInputResponses: async (taskId: string, responses: McpTaskInputResponses) => {
      const row = await assertOwnedRow(taskId);
      const outstanding = row.inputRequests ?? {};
      const resolvedKeys = new Set(row.resolvedInputKeys ?? []);
      const applied: string[] = [];

      for (const [key, value] of Object.entries(responses)) {
        // Ignore unknown or already-satisfied keys without error, per spec.
        if (!Object.hasOwn(outstanding, key) || resolvedKeys.has(key)) continue;
        applied.push(key);
        resolvedKeys.add(key);
        const waiter = inputWaiters.get(waiterKey(taskId, key));
        if (waiter) {
          waiter.resolve(value);
          inputWaiters.delete(waiterKey(taskId, key));
        }
      }

      const appliedThisCall = new Set(applied);
      const remaining = Object.fromEntries(
        Object.entries(outstanding).filter(([key]) => !appliedThisCall.has(key)),
      );

      const stillWaiting = Object.keys(remaining).length > 0;
      const updated = await persistAndNotify(taskId, {
        inputRequests: remaining,
        resolvedInputKeys: [...resolvedKeys],
        status: stillWaiting ? 'input_required' : 'working',
      });
      return { applied, task: toDetailedTask(updated) };
    },

    recordCancellationIntent: async (taskId: string) => {
      const row = await assertOwnedRow(taskId);
      // Recorded unconditionally: even when the row is already terminal (the work won the race),
      // the intent itself is still true and durable — this is the whole point of the column.
      const [marked] = await db
        .update(mcpTask)
        .set({ cancellationRequested: true, cancellationRequestedAt: sql`now()` })
        .where(eq(mcpTask.id, taskId))
        .returning();
      if (!marked) throw notFound(taskId);
      let finalRow = marked;
      if (!isTerminalTaskStatus(row.status) && !isTerminalTaskStatus(finalRow.status)) {
        finalRow = await persistAndNotify(taskId, { status: 'cancelled' });
        const waiting = Object.keys(finalRow.inputRequests ?? {});
        for (const key of waiting) {
          const waiter = inputWaiters.get(waiterKey(taskId, key));
          if (waiter) {
            waiter.reject(new Error(`Task ${taskId} was cancelled`));
            inputWaiters.delete(waiterKey(taskId, key));
          }
        }
      }
      return toDetailedTask(finalRow);
    },

    listTasks: async (cursor?: string) => {
      await evictExpired(owner);
      const PAGE_SIZE = 10;

      let afterSeq: number | undefined;
      if (cursor) {
        const [cursorRow] = await db
          .select({ seq: mcpTask.seq })
          .from(mcpTask)
          .where(and(eq(mcpTask.id, cursor), eq(mcpTask.ownerKey, owner)))
          .limit(1);
        if (!cursorRow) throw new Error(`Invalid cursor: ${cursor}`);
        afterSeq = cursorRow.seq;
      }

      const rows = await db
        .select()
        .from(mcpTask)
        .where(
          afterSeq !== undefined
            ? and(eq(mcpTask.ownerKey, owner), gt(mcpTask.seq, afterSeq))
            : eq(mcpTask.ownerKey, owner),
        )
        .orderBy(asc(mcpTask.seq))
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      const hasMore = rows.length > PAGE_SIZE;
      const lastId = hasMore ? page[page.length - 1]?.id : undefined;
      return {
        tasks: page.map(toSdkTask),
        ...(lastId !== undefined ? { nextCursor: lastId } : {}),
      };
    },
  } satisfies DocketTaskStore;
}
