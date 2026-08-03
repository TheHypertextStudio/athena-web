/**
 * `@docket/api` — the synthetic `mcp_subscription.uri` a task's `subscriptions/listen`
 * registration uses.
 *
 * @remarks
 * Split into its own module so both `notify.ts` (publishing `notifications/tasks`) and
 * `task-protocol.ts` (registering the listener) can share the exact format string without
 * importing from one another — `notify.ts` is generic notification plumbing that predates the
 * MCP Tasks extension, and `task-store.ts`/`task-protocol.ts` both depend on it already.
 */

/** Build the listener URI for a task id, addressable through `mcp_subscription` like any URI. */
export function taskListenerUri(taskId: string): string {
  return `mcp-task:${taskId}`;
}
