import { deleteMentionsForSubject, reconcileMentions } from '../content/reconcile-mentions';
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

/**
 * Re-derive the mention edges for a written row.
 *
 * @remarks
 * Awaited, unlike {@link announce}, because the Resources tab must reflect a save the moment the
 * save returns — a user who writes a link and switches tabs should not race a background job. It
 * costs a Markdown parse and a handful of statements, with no network call on the write path.
 *
 * A failure is logged and swallowed. Mentions are derived data: losing them is a display bug the
 * next write repairs, whereas failing the caller's request would turn a display bug into a lost
 * edit.
 */
async function reconcile(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  try {
    await reconcileMentions(organizationId, sourceTable, entityId);
  } catch (err) {
    console.warn('Mention reconcile failed', { sourceTable, entityId }, err);
  }
}

/** Enqueue a source-row upsert after a domain write commits, reconcile its mentions, and notify MCP subscribers. */
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
  await reconcile(organizationId, sourceTable, entityId);
  announce(organizationId, sourceTable, entityId);
}

/** Enqueue a source-row delete/archive after a domain delete commits, drop its mentions, and notify subscribers. */
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
  try {
    await deleteMentionsForSubject(sourceTable, entityId);
  } catch (err) {
    console.warn('Mention cleanup failed', { sourceTable, entityId }, err);
  }
  announce(organizationId, sourceTable, entityId);
}
