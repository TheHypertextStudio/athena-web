import { enqueueSearchIndexJob } from './enqueue';

/** Enqueue a source-row upsert after a domain write commits. */
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
}

/** Enqueue a source-row delete/archive after a domain delete commits. */
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
}
