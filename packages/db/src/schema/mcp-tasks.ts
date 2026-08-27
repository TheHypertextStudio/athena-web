/**
 * `@docket/db` — MCP Tasks extension storage (`io.modelcontextprotocol/tasks`).
 *
 * @remarks
 * Backs {@link "@docket/api".task-store} so a task id survives the process that created it: the
 * Streamable HTTP transport builds a fresh, stateless server per request (see
 * `apps/api/src/mcp/server.ts`), so anything that must outlive one request — including a task
 * created in one POST and polled by a later one, or one that outlives a server restart — has to
 * live in Postgres, the same way `mcp_session`/`mcp_subscription` already do for the notification
 * channel.
 *
 * `inputRequests`/`resolvedInputKeys` implement the extension's mid-flight input mechanism: a task
 * in `input_required` carries the server-to-client requests it is waiting on, and a key is retired
 * into `resolvedInputKeys` the moment a `tasks/update` answers it — the spec forbids reusing a key
 * for a second request, so once-satisfied keys are never allowed to reappear.
 *
 * This is operational state, not domain data: no `organization_id`, and rows are expected to be
 * short-lived (evicted once `ttlMs` elapses past `lastUpdatedAt`, deliberately unlike a work item).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** The task lifecycle states the MCP Tasks extension defines, in the spec's own order. */
export type McpTaskStatusColumn =
  'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

/**
 * One MCP task: durable state for a `tools/call` the server chose to run asynchronously.
 *
 * @remarks
 * `ownerKey` is the security-critical column, mirroring `mcp_session.principal_key` — a task
 * created by one principal must never be readable, cancellable, or listable by another, and the
 * lookup path always filters on it rather than trusting a bare `taskId` (which is otherwise an
 * unguessable bearer token per the spec's own security section).
 */
export const mcpTask = pgTable(
  'mcp_task',
  {
    id: text('id').primaryKey(),
    /** Monotonic creation order, independent of `createdAt` clock resolution — sort key only. */
    seq: serial('seq').notNull(),
    ownerKey: text('owner_key').notNull(),
    sessionId: text('session_id'),
    status: text('status').notNull().$type<McpTaskStatusColumn>(),
    statusMessage: text('status_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow(),
    /** Milliseconds from `createdAt`; `null` means unlimited (never auto-evicted). */
    ttlMs: integer('ttl_ms'),
    pollIntervalMs: integer('poll_interval_ms'),
    /** The stored `CallToolResult` (or other request result) once `status` is `completed`. */
    result: jsonb('result').$type<Record<string, unknown>>(),
    /** The JSON-RPC error once `status` is `failed`. */
    error: jsonb('error').$type<Record<string, unknown>>(),
    /** Outstanding server→client requests while `status` is `input_required`, keyed per spec. */
    inputRequests: jsonb('input_requests').$type<Record<string, unknown>>(),
    /** Input-request keys ever satisfied, kept forever so a key can never be reused. */
    resolvedInputKeys: jsonb('resolved_input_keys').$type<string[]>(),
    /**
     * Whether a client has ever sent `tasks/cancel` for this task.
     *
     * @remarks
     * Recorded unconditionally, independent of whether cancellation actually won the race against
     * the work finishing — a task can end `completed` with this still `true`, and that combination
     * is the one the launch requirement calls out by name.
     */
    cancellationRequested: boolean('cancellation_requested').notNull().default(false),
    cancellationRequestedAt: timestamp('cancellation_requested_at'),
  },
  (t) => [
    index('mcp_task_owner_idx').on(t.ownerKey),
    // Drives the TTL eviction sweep, which reads "old enough to maybe be expired" off this column
    // rather than a per-row expiresAt so `ttlMs` can change over a task's lifetime per spec.
    index('mcp_task_last_updated_idx').on(t.lastUpdatedAt),
  ],
);
