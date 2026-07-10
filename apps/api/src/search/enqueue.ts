import { and, eq, inArray } from 'drizzle-orm';

/** Input required to enqueue one durable search-index operation. */
export interface EnqueueSearchIndexJobInput {
  organizationId?: string | null;
  userId?: string | null;
  sourceTable: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  reason: 'entity_write' | 'event_log' | 'backfill' | 'repair' | 'manual';
  sourceEventId?: string | null;
  runAfter?: Date;
}

/** Stable key that collapses repeated active jobs for the same indexing intent. */
export function searchIndexJobDedupeKey(input: EnqueueSearchIndexJobInput): string {
  return [
    input.organizationId ?? input.userId ?? 'global',
    input.sourceTable,
    input.entityId,
    input.operation,
    input.reason,
    input.sourceEventId ?? '',
  ].join(':');
}

/** Enqueue one durable search indexing job, returning the active job id. */
export async function enqueueSearchIndexJob(input: EnqueueSearchIndexJobInput): Promise<string> {
  const schema = await import('@docket/db');
  const dedupeKey = searchIndexJobDedupeKey(input);
  const active = await schema.db
    .select({ id: schema.searchIndexJob.id })
    .from(schema.searchIndexJob)
    .where(
      and(
        eq(schema.searchIndexJob.dedupeKey, dedupeKey),
        inArray(schema.searchIndexJob.status, ['pending', 'processing']),
      ),
    )
    .limit(1);
  const existing = active[0];
  if (existing) return existing.id;

  const [inserted] = await schema.db
    .insert(schema.searchIndexJob)
    .values({
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      sourceTable: input.sourceTable,
      entityId: input.entityId,
      operation: input.operation,
      reason: input.reason,
      sourceEventId: input.sourceEventId ?? null,
      dedupeKey,
      runAfter: input.runAfter,
    })
    .onConflictDoNothing()
    .returning({ id: schema.searchIndexJob.id });
  if (inserted) return inserted.id;

  const [conflicted] = await schema.db
    .select({ id: schema.searchIndexJob.id })
    .from(schema.searchIndexJob)
    .where(eq(schema.searchIndexJob.dedupeKey, dedupeKey))
    .limit(1);
  if (!conflicted) throw new Error(`search index job conflict without existing row: ${dedupeKey}`);
  return conflicted.id;
}

/** Enqueue a batch of search indexing jobs sequentially to honor the active dedupe index. */
export async function enqueueSearchIndexJobs(
  inputs: readonly EnqueueSearchIndexJobInput[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const input of inputs) ids.push(await enqueueSearchIndexJob(input));
  return ids;
}
