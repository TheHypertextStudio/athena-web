/**
 * `@docket/types` — the MCP Tasks extension wire protocol (`io.modelcontextprotocol/tasks`).
 *
 * @remarks
 * Transcribed from the committed copy of the specification at
 * `docs/engineering/specs/vendor/mcp-tasks-draft.md` (version `draft`, retrieved 2026-08-02).
 * A conformance suite reads that file and fails if a method, status, or field named there is
 * missing here, so this module cannot drift from the text it claims to implement.
 *
 * The distinction that matters most for Docket: a task models work that is **in progress or has
 * execution pending**. It is not a record of what happened. Terminal tasks exist only long enough
 * for the caller that started them to collect the result, then they are evicted. Docket work rows
 * — a completed task, a cancelled project, a backlog item — are never tasks.
 *
 * @see {@link https://modelcontextprotocol.io/extensions/tasks/overview}
 */

/** The extension identifier reserved for MCP Tasks. */
export const MCP_TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';

/**
 * The `_meta` key a client declares its per-request capabilities under.
 *
 * @remarks
 * Task support is negotiated per request, not once at `initialize`: the client repeats its
 * declaration on every call it is willing to receive a task handle for. That is what makes
 * "never return a task to a client that did not declare support" checkable at the point of use.
 */
export const MCP_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities';

/** Every JSON-RPC method the MCP Tasks extension defines. */
export const MCP_TASK_METHODS = {
  /** Client → Server: read a task's current state, including its terminal result or error. */
  get: 'tasks/get',
  /** Client → Server: answer outstanding `inputRequests`. */
  update: 'tasks/update',
  /** Client → Server: signal intent to cancel. Cooperative; the ack is not a stop. */
  cancel: 'tasks/cancel',
  /** Client → Server: opt into pushed status updates for a set of task ids. */
  listen: 'subscriptions/listen',
} as const;

/** A request method defined by the MCP Tasks extension. */
export type McpTaskMethod = (typeof MCP_TASK_METHODS)[keyof typeof MCP_TASK_METHODS];

/** Every notification the MCP Tasks extension defines. */
export const MCP_TASK_NOTIFICATIONS = {
  /** Server → Client: the full task state at a status transition. */
  status: 'notifications/tasks',
  /** Server → Client: which of the requested subscriptions were accepted. */
  subscriptionsAcknowledged: 'notifications/subscriptions/acknowledged',
} as const;

/** A notification method defined by the MCP Tasks extension. */
export type McpTaskNotification =
  (typeof MCP_TASK_NOTIFICATIONS)[keyof typeof MCP_TASK_NOTIFICATIONS];

/** The polymorphic-result discriminator value reserved for a task handle. */
export const MCP_TASK_RESULT_TYPE = 'task';

/** The `resultType` every non-task result carries. */
export const MCP_COMPLETE_RESULT_TYPE = 'complete';

/**
 * JSON-RPC error code for a request that requires a client capability the caller did not declare.
 *
 * @remarks
 * The spec calls this `MISSING_REQUIRED_CLIENT_CAPABILITY`. It is what a `tasks/*` request from a
 * client that never declared the extension must receive.
 */
export const MCP_MISSING_CLIENT_CAPABILITY = -32003;

/** JSON-RPC error code for an unknown or expired task id. */
export const MCP_INVALID_PARAMS = -32602;

/** JSON-RPC error code for a server-side failure while servicing a task request. */
export const MCP_INTERNAL_ERROR = -32603;

/** Every task status, in the spec's own order. */
export const MCP_TASK_STATUSES = [
  'working',
  'input_required',
  'completed',
  'failed',
  'cancelled',
] as const;

/** The state a task is in. */
export type McpTaskStatus = (typeof MCP_TASK_STATUSES)[number];

/** The statuses from which a task never moves again. */
export const MCP_TERMINAL_TASK_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/** A status a task never leaves. */
export type McpTerminalTaskStatus = (typeof MCP_TERMINAL_TASK_STATUSES)[number];

/**
 * Whether a status is terminal.
 *
 * @param status - Any task status.
 * @returns `true` when the task will never change state again.
 */
export function isTerminalTaskStatus(status: McpTaskStatus): status is McpTerminalTaskStatus {
  return (MCP_TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a status means work is in progress or pending execution.
 *
 * @remarks
 * This is the predicate that decides what may be modelled as an MCP task at all. `input_required`
 * counts: the work is started and is waiting on the caller, not finished.
 *
 * @param status - Any task status.
 * @returns `true` for `working` and `input_required`.
 */
export function isLiveTaskStatus(status: McpTaskStatus): boolean {
  return status === 'working' || status === 'input_required';
}

/** The operational metadata every task carries. */
export interface McpTask {
  /** Stable identifier. Unguessable: it is a bearer token for the task's stored state. */
  readonly taskId: string;
  readonly status: McpTaskStatus;
  /** Human-readable note about the current state. May be shown to the user or the model. */
  readonly statusMessage?: string;
  /** ISO 8601. */
  readonly createdAt: string;
  /** ISO 8601. */
  readonly lastUpdatedAt: string;
  /** Milliseconds from creation after which the server may discard the task; `null` = unlimited. */
  readonly ttlMs: number | null;
  /** Milliseconds the client should wait between polls. */
  readonly pollIntervalMs?: number;
}

/** A server-to-client request surfaced mid-task, keyed by an identifier unique to the task. */
export interface McpTaskInputRequest {
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** The map of outstanding requests a task in `input_required` exposes. */
export type McpTaskInputRequests = Readonly<Record<string, McpTaskInputRequest>>;

/** The map of answers a client submits through `tasks/update`. */
export type McpTaskInputResponses = Readonly<Record<string, unknown>>;

/** A task plus whichever status-specific payload its state carries. */
export type McpDetailedTask = McpTask & {
  readonly inputRequests?: McpTaskInputRequests;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: Readonly<Record<string, unknown>>;
};

/** The result a server returns in lieu of the synchronous one when it materializes a task. */
export type McpCreateTaskResult = McpTask & {
  readonly resultType: typeof MCP_TASK_RESULT_TYPE;
};

/** The `tasks/get` result: a detailed task, carrying the standard `complete` discriminator. */
export type McpGetTaskResult = McpDetailedTask & {
  readonly resultType: typeof MCP_COMPLETE_RESULT_TYPE;
};

/**
 * Whether a client's declared per-request capabilities include the tasks extension.
 *
 * @remarks
 * Reads `params._meta['io.modelcontextprotocol/clientCapabilities'].extensions` and looks for the
 * extension key. Written defensively — every field on the path is attacker-controlled JSON — and
 * returns `false` rather than throwing for anything malformed, because the correct response to a
 * malformed declaration is the synchronous result shape, not a crash.
 *
 * @param params - The `params` object of an inbound JSON-RPC request.
 * @returns `true` when the caller declared `io.modelcontextprotocol/tasks`.
 */
export function declaresTasksExtension(params: unknown): boolean {
  if (typeof params !== 'object' || params === null) return false;
  const meta: unknown = Reflect.get(params, '_meta');
  if (typeof meta !== 'object' || meta === null) return false;
  const capabilities: unknown = Reflect.get(meta, MCP_CLIENT_CAPABILITIES_META_KEY);
  if (typeof capabilities !== 'object' || capabilities === null) return false;
  const extensions: unknown = Reflect.get(capabilities, 'extensions');
  if (typeof extensions !== 'object' || extensions === null) return false;
  return Object.hasOwn(extensions, MCP_TASKS_EXTENSION);
}

/** The `data` payload accompanying a {@link MCP_MISSING_CLIENT_CAPABILITY} error. */
export const MCP_TASKS_REQUIRED_CAPABILITY_DATA = {
  requiredCapabilities: { extensions: { [MCP_TASKS_EXTENSION]: {} } },
} as const;

/** `params` for a `tasks/get` request. */
export interface McpGetTaskParams {
  readonly taskId: string;
}

/** `params` for a `tasks/cancel` request. */
export interface McpCancelTaskParams {
  readonly taskId: string;
}

/** `params` for a `tasks/update` request. */
export interface McpUpdateTaskParams {
  readonly taskId: string;
  readonly inputResponses: McpTaskInputResponses;
}

/** The empty acknowledgement `tasks/update` and `tasks/cancel` (when not returning a task) share. */
export interface McpUpdateTaskResult {
  readonly resultType: typeof MCP_COMPLETE_RESULT_TYPE;
}

/** `params` for a `subscriptions/listen` request scoped to task status notifications. */
export interface McpSubscriptionsListenParams {
  readonly notifications: {
    readonly taskIds?: readonly string[];
  };
}

/** The empty acknowledgement `subscriptions/listen` returns as its RPC result. */
export type McpSubscriptionsListenResult = Record<string, never>;

/** `params` for the `notifications/subscriptions/acknowledged` push. */
export interface McpSubscriptionsAcknowledgedParams {
  readonly notifications: {
    readonly taskIds?: readonly string[];
  };
}

/**
 * `params` for a `notifications/tasks` push.
 *
 * @remarks
 * Identical to what `tasks/get` would have returned at that moment — a full {@link McpDetailedTask}
 * — per "Each notification carries a complete `DetailedTask` for the current status."
 */
export type McpTaskStatusNotificationParams = McpDetailedTask;
