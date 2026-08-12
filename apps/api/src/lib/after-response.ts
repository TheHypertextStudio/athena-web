/**
 * `@docket/api` — work that a request schedules but does not wait for.
 *
 * @remarks
 * A create does more than insert a row: it appends an activity event, routes that event to its
 * recipients, enqueues search indexing, reconciles mentions, and notifies MCP subscribers. Every
 * one of those was awaited before the response went out, so the person who clicked "Create" paid
 * for all of it — roughly fifteen to twenty-five database round trips where the insert was one.
 *
 * None of it is something the caller reads back in the same breath. Scheduling it here lets the
 * response leave as soon as the row is committed, while the work still runs to completion in the
 * same process.
 *
 * The deliberate difference from a bare floating promise is accountability. Deferred work is
 * invisible to the request that scheduled it, so a failure has nowhere to surface unless
 * something reports it, and a process that exits mid-flight simply loses it. This module keeps
 * every scheduled item tracked, logs whatever fails, and gives shutdown something to wait on.
 */

/** Work that is still running. Tracked so shutdown can wait for it rather than drop it. */
const pending = new Set<Promise<void>>();

/**
 * Record a failure in deferred work.
 *
 * @param label - What was being done, so a log line names the failing stage.
 * @param error - The thrown value.
 */
function reportFailure(label: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      source: 'api',
      event: 'deferred_work_failed',
      label,
      /* v8 ignore next 2 -- @preserve defensive: lint forbids first-party code from rejecting
         with a non-Error, so only a third-party client can reach the `String(error)` path.
         Keeping it is what stops such a value being logged as "[object Object]". */
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
}

/**
 * Run `work` after the current request has been answered.
 *
 * @param label - A short, stable name for the work (appears in failure logs).
 * @param work - The side effect to run. May be sync or async; either way its failure is reported
 *   rather than propagated, because there is no longer a caller to propagate it to.
 *
 * @remarks
 * Use this only for effects the response does not depend on. Anything a client reads back
 * immediately — a description's mention edges, for instance — must stay awaited, or the very
 * next read races the write that was supposed to produce it.
 *
 * @example
 * ```ts
 * deferAfterResponse('project-created-event', () => emitEvent({ ... }));
 * return ok(c, ProjectOut, toOut(row));
 * ```
 */
export function deferAfterResponse(label: string, work: () => void | Promise<void>): void {
  // `Promise.resolve().then(work)` rather than calling `work()` directly: it gives a synchronous
  // throw the same treatment as a rejected promise, so one bad input cannot escape as an
  // exception in the middle of a handler that has already decided not to wait.
  const task = Promise.resolve()
    .then(work)
    .catch((error: unknown) => {
      reportFailure(label, error);
    })
    .finally(() => {
      pending.delete(task);
    });
  pending.add(task);
}

/**
 * Wait for every scheduled item, including work scheduled by work already running.
 *
 * @returns Nothing; resolves when nothing is left in flight.
 *
 * @remarks
 * Called on shutdown, where this is the last chance the work gets. Draining repeatedly rather
 * than once matters because these effects chain — emitting an event enqueues indexing jobs — so a
 * single pass would wait for the first generation and abandon the one it spawned.
 */
export async function flushDeferredWork(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

/**
 * How many deferred items are still in flight.
 *
 * @returns The count of unsettled scheduled items.
 *
 * @remarks
 * Exists so the behavior can be asserted directly; nothing in production branches on it.
 */
export function pendingDeferredCount(): number {
  return pending.size;
}
