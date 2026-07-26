import { notifyResourceUpdated } from '../mcp/notify';

import { enqueueSearchIndexJob } from './enqueue';

/**
 * The source tables that are addressable as a `docket://{org}/{type}/{id}` resource.
 *
 * @remarks
 * Only these can be subscribed to, so only these are worth a notify lookup. A write to anything
 * else (a join row, an index job) still indexes, it just has no URI to announce.
 */
const NOTIFIABLE_TABLES = new Set([
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
  'team',
  'update',
  'comment',
  'agent_session',
]);

/**
 * Announce an entity change to every MCP session subscribed to it.
 *
 * @remarks
 * This rides the search write-through rather than sitting beside its ~40 call sites, because a
 * write path that forgets to notify is indistinguishable from a broken subscription — and the
 * arguments here already map 1:1 onto the resource URI. Failure is swallowed: a missed
 * notification is a stale client, but a throw here would fail the write that caused it.
 *
 * @param organizationId - The owning organization.
 * @param sourceTable - The written table, mapped to the URI's `{type}` segment.
 * @param entityId - The written row.
 */
async function announce(
  organizationId: string,
  sourceTable: string,
  entityId: string,
): Promise<void> {
  if (!NOTIFIABLE_TABLES.has(sourceTable)) return;
  const type = sourceTable === 'agent_session' ? 'session' : sourceTable;
  try {
    await notifyResourceUpdated(`docket://${organizationId}/${type}/${entityId}`);
  } catch (err) {
    // Never fail a write over a notification — but never lose the failure either. A silent catch
    // here once hid a malformed query that disabled every subscription in the process.
    console.warn('MCP resource notification failed', err);
  }
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
  await announce(organizationId, sourceTable, entityId);
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
  await announce(organizationId, sourceTable, entityId);
}
