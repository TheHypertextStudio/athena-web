import { notifyResourceUpdated } from '../mcp/notify';
import { entityUri } from '../mcp/resources';

import { enqueueSearchIndexJob } from './enqueue';

/**
 * Announce an entity change to every MCP session subscribed to it.
 *
 * @remarks
 * This rides the search write-through rather than sitting beside its ~40 call sites, because a
 * write path that forgets to notify is indistinguishable from a broken subscription. The URI is
 * built by {@link entityUri} so the write path and the read path cannot disagree about the scheme.
 *
 * Deliberately not awaited by the caller: the result is discarded either way, and a notification
 * has no business adding a round trip to the critical path of every write in the product. Failures
 * are logged rather than swallowed — a silent catch here once hid a malformed query that disabled
 * every subscription in the process.
 *
 * @param organizationId - The owning organization.
 * @param sourceTable - The written table.
 * @param entityId - The written row.
 */
function announce(organizationId: string, sourceTable: string, entityId: string): void {
  const uri = entityUri(organizationId, sourceTable, entityId);
  if (!uri) return;
  void notifyResourceUpdated(uri).catch((err: unknown) => {
    console.warn('MCP resource notification failed', err);
  });
}

/** Enqueue a source-row upsert after a domain write commits, and notify MCP subscribers. */
export async function enqueueSearchUpsert(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  await enqueueSearchIndexJob({
    organizationId,
    sourceTable,
    entityId,
    operation: 'upsert',
    reason: 'entity_write',
  });
  announce(organizationId, sourceTable, entityId);
}

/** Enqueue a source-row delete/archive after a domain delete commits, and notify subscribers. */
export async function enqueueSearchDelete(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  await enqueueSearchIndexJob({
    organizationId,
    sourceTable,
    entityId,
    operation: 'delete',
    reason: 'entity_write',
  });
  announce(organizationId, sourceTable, entityId);
}
