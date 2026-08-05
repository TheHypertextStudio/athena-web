/**
 * The composition root for entity-write notifications.
 *
 * @remarks
 * The one place that knows both which bus exists and who listens on it. Everything that publishes
 * asks for the bus; everything that listens is constructed here. Adding a listener is an edit to
 * this file and a new subscriber module, never a change to the write paths.
 *
 * Memoized per process rather than constructed per call, because the subscriber list is
 * configuration, not request state.
 */
import { createDrizzleMentionStorage } from '../content/drizzle-mention-storage';
import { createMentionReconciler } from '../content/reconcile-mentions';

import { EntityWriteBus } from './entity-write-bus';
import {
  mcpNotifySubscriber,
  mentionReconcileSubscriber,
  searchIndexSubscriber,
} from './entity-write-subscribers';

let bus: EntityWriteBus | undefined;

/**
 * Wire the bus with the subscribers this application runs.
 *
 * @remarks
 * Exported so a test can build an identically-wired bus over substitute storage, rather than
 * reaching into module state to find out what production does.
 *
 * @param storage - Where the mention reconciler reads and writes.
 * @returns A wired bus.
 */
export function buildEntityWriteBus(storage = createDrizzleMentionStorage()): EntityWriteBus {
  return new EntityWriteBus()
    .subscribe(searchIndexSubscriber())
    .subscribe(mentionReconcileSubscriber(createMentionReconciler(storage)))
    .subscribe(mcpNotifySubscriber());
}

/** The process-wide bus, built on first use. */
export function getEntityWriteBus(): EntityWriteBus {
  bus ??= buildEntityWriteBus();
  return bus;
}

/** Replace the process-wide bus. Test-only seam; production never calls this. */
export function setEntityWriteBus(replacement: EntityWriteBus | undefined): void {
  bus = replacement;
}
