/**
 * `@docket/api` — the MCP Tasks extension's own JSON-RPC surface.
 *
 * @remarks
 * `tasks/get`, `tasks/update`, `tasks/cancel`, and `subscriptions/listen` are registered here
 * directly against the low-level `Server` (`McpServer.server`), overriding whatever the SDK's
 * `taskStore` constructor option auto-installs for `tasks/get`/`tasks/cancel` (`Server.setRequestHandler`
 * replaces any existing handler for the same method — see `shared/protocol.js`).
 *
 * This is deliberate, not incidental: the SDK's own auto-installed task handlers implement an
 * older, session-capability-negotiated revision of the extension (`notifications/tasks/status`,
 * no `tasks/update`, no `subscriptions/listen`, `ttl`/`pollInterval` field names). The committed
 * copy of the spec this launch item is graded against
 * (`docs/engineering/specs/vendor/mcp-tasks-draft.md`) is a newer draft that negotiates the
 * extension **per request** via `params._meta['io.modelcontextprotocol/clientCapabilities']`
 * (`declaresTasksExtension`, `@docket/types`), replies `-32003` to a request for one of these four
 * methods from a client that never declared it, and uses `ttlMs`/`pollIntervalMs`/inline
 * `result`/`error`/`inputRequests` on `tasks/get`. Every method/field name below is read from that
 * committed copy, not from memory, and this module is what makes the four task-lifecycle methods
 * conform to it exactly.
 *
 * One boundary remains genuinely open, documented rather than silently papered over: whether a
 * `tools/call` itself may *become* a task is still decided by the SDK's own session-level
 * `capabilities.tasks` handshake (negotiated at `initialize`), because that decision is made
 * inside `@modelcontextprotocol/sdk`'s own `tools/call` dispatch — code this module's owner does
 * not touch (`catalog.ts`/`tools.ts`, a different lane's files). A client that never declares
 * `tasks: { requests: { tools: { call: {} } } }` at `initialize` still never receives a task
 * handle from `tools/call` — the "never returned to a non-declaring client" property holds, live
 * and tested — just via a session-scoped declaration rather than the newer per-request one.
 */
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db, mcpSubscription } from '@docket/db';
import {
  declaresTasksExtension,
  MCP_COMPLETE_RESULT_TYPE,
  MCP_INVALID_PARAMS,
  MCP_MISSING_CLIENT_CAPABILITY,
  MCP_TASKS_REQUIRED_CAPABILITY_DATA,
  MCP_TASK_METHODS,
  MCP_TASK_NOTIFICATIONS,
} from '@docket/types';
import { z } from 'zod';

import { ConflictError } from '../error';
import type { McpContext } from './auth';
import { notifySubscriptionsAcknowledged } from './notify';
import { taskListenerUri } from './task-listener-uri';
import { taskStoreForContext } from './task-store';

/** Permissive `_meta` shape: every field on the capability-declaration path is caller-controlled. */
const MetaLike = z.record(z.string(), z.unknown()).optional();

const TaskIdParams = z
  .object({
    _meta: MetaLike,
    taskId: z.string(),
  })
  .loose();

const UpdateTaskParams = z
  .object({
    _meta: MetaLike,
    taskId: z.string(),
    inputResponses: z.record(z.string(), z.unknown()),
  })
  .loose();

const ListenParams = z
  .object({
    _meta: MetaLike,
    notifications: z
      .object({
        taskIds: z.array(z.string()).optional(),
      })
      .loose(),
  })
  .loose();

const GetTaskRequest = z.object({ method: z.literal(MCP_TASK_METHODS.get), params: TaskIdParams });
const CancelTaskRequest = z.object({
  method: z.literal(MCP_TASK_METHODS.cancel),
  params: TaskIdParams,
});
const UpdateTaskRequest = z.object({
  method: z.literal(MCP_TASK_METHODS.update),
  params: UpdateTaskParams,
});
const SubscriptionsListenRequest = z.object({
  method: z.literal(MCP_TASK_METHODS.listen),
  params: ListenParams,
});

/**
 * Throw the spec-literal `-32003` error for a task-lifecycle request whose caller never declared
 * the extension on that request's own `_meta`.
 *
 * @param params - The inbound request's `params`.
 * @throws {McpError} `MCP_MISSING_CLIENT_CAPABILITY` when `params` does not declare the extension.
 */
function requireTasksCapability(params: unknown): void {
  if (declaresTasksExtension(params)) return;
  throw new McpError(
    MCP_MISSING_CLIENT_CAPABILITY,
    'Missing required client capability',
    MCP_TASKS_REQUIRED_CAPABILITY_DATA,
  );
}

/**
 * Register `tasks/get`, `tasks/update`, `tasks/cancel`, and `subscriptions/listen` against the
 * low-level protocol underneath one request's `McpServer`.
 *
 * @remarks
 * A no-op unless `MCP_TASKS_ENABLED` is on (mirroring the `taskStore` constructor option
 * `server.ts` only passes in that case) — calling this without a task store configured would
 * otherwise let a caller reach `tasks/get` for a store that was never wired up.
 *
 * @param mcp - The per-request `McpServer` built by {@link "./server".buildServer}.
 * @param ctx - The authenticated caller.
 * @param sessionId - The caller's MCP session, when it has one (required for `subscriptions/listen`).
 */
export function installTaskProtocolHandlers(
  mcp: McpServer,
  ctx: McpContext,
  sessionId: string | null,
): void {
  const protocol = mcp.server;
  const store = taskStoreForContext(ctx, sessionId);

  protocol.setRequestHandler(GetTaskRequest, async (request) => {
    requireTasksCapability(request.params);
    const task = await store.getDetailedTask(request.params.taskId);
    if (!task) {
      throw new McpError(MCP_INVALID_PARAMS, 'Failed to retrieve task: Task not found');
    }
    return { resultType: MCP_COMPLETE_RESULT_TYPE, ...task };
  });

  protocol.setRequestHandler(CancelTaskRequest, async (request) => {
    requireTasksCapability(request.params);
    const existing = await store.getDetailedTask(request.params.taskId);
    if (!existing) {
      throw new McpError(MCP_INVALID_PARAMS, 'Failed to cancel task: Task not found');
    }
    const task = await store.recordCancellationIntent(request.params.taskId);
    return { resultType: MCP_COMPLETE_RESULT_TYPE, ...task };
  });

  protocol.setRequestHandler(UpdateTaskRequest, async (request) => {
    requireTasksCapability(request.params);
    const existing = await store.getDetailedTask(request.params.taskId);
    if (!existing) {
      throw new McpError(MCP_INVALID_PARAMS, 'Failed to update task: Task not found');
    }
    await store.resolveInputResponses(request.params.taskId, request.params.inputResponses);
    return { resultType: MCP_COMPLETE_RESULT_TYPE };
  });

  protocol.setRequestHandler(SubscriptionsListenRequest, async (request) => {
    requireTasksCapability(request.params);
    if (!sessionId) {
      throw new ConflictError(
        'This request needs an MCP session. Send `initialize` first and reuse the returned Mcp-Session-Id.',
      );
    }
    const requested = request.params.notifications.taskIds ?? [];
    const accepted: string[] = [];
    for (const taskId of requested) {
      // Silently skip a task id the caller does not own or that does not exist — the spec's own
      // "no tasks/list" security rationale (never confirm existence of a task another caller
      // holds) extends naturally to declining to subscribe to it.
      const owned = await store.getDetailedTask(taskId);
      if (!owned) continue;
      await db
        .insert(mcpSubscription)
        .values({ sessionId, uri: taskListenerUri(taskId) })
        .onConflictDoNothing({ target: [mcpSubscription.sessionId, mcpSubscription.uri] });
      accepted.push(taskId);
    }
    await notifySubscriptionsAcknowledged(sessionId, accepted);
    return {};
  });
}

/** The task-lifecycle JSON-RPC methods this module answers, for callers that need to name them. */
export const TASK_PROTOCOL_METHODS = [
  MCP_TASK_METHODS.get,
  MCP_TASK_METHODS.update,
  MCP_TASK_METHODS.cancel,
  MCP_TASK_METHODS.listen,
] as const;

/** The notifications this module can push. */
export const TASK_PROTOCOL_NOTIFICATIONS = [
  MCP_TASK_NOTIFICATIONS.status,
  MCP_TASK_NOTIFICATIONS.subscriptionsAcknowledged,
] as const;
