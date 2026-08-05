/**
 * The one seam every domain write goes through after it commits.
 *
 * @remarks
 * This rides beside the ~40 write call sites rather than being repeated at each, because a write
 * path that forgets to announce is indistinguishable from one where nothing happened.
 *
 * What it announces *to* is deliberately not its business. It publishes an event; the composition
 * root decides who listens. Before that inversion this module imported the search enqueue, the MCP
 * notifier, and the mention reconciler, so every feature that cared about writes became a
 * dependency of the seam — and the next one would have made it a fourth.
 */
import { getEntityWriteBus } from '../events/entity-write-registry';

/** Announce that an entity was written, and wait for the derived state to catch up. */
export async function enqueueSearchUpsert(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  await getEntityWriteBus().publish({
    organizationId,
    sourceTable,
    entityId,
    operation: 'upsert',
  });
}

/** Announce that an entity was removed. */
export async function enqueueSearchDelete(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  await getEntityWriteBus().publish({
    organizationId,
    sourceTable,
    entityId,
    operation: 'delete',
  });
}
