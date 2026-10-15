import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { convertRetainedRevision } from './work-template-blueprint-migration/convert';
import { migrationRows } from './work-template-blueprint-migration/query';

/** A batch of complete source receipts has committed before this observer runs. */
export interface BlueprintBackfillProgress {
  readonly revisions: number;
  readonly publishedRoots: number;
  readonly preservedDrafts: number;
}
/** Bounded resumable0154 checkpoint controls; identity onBatch remains independent. */
export interface BlueprintBackfillOptions {
  readonly batchSize?: number;
  readonly onBlueprintBatch?: (progress: BlueprintBackfillProgress) => void | Promise<void>;
}
/** Counts of preserved/converted source revisions; no concrete work is created by this checkpoint. */
export interface BlueprintBackfillResult {
  readonly revisions: number;
  readonly publishedRoots: number;
  readonly preservedDrafts: number;
}

/** Repeatedly scan missing receipts, including older IDs inserted between committed batches. */
export async function backfillWorkTemplateBlueprints(
  database: Database,
  options: BlueprintBackfillOptions = {},
): Promise<BlueprintBackfillResult> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new RangeError('Blueprint checkpoint batches must contain1 through1000 revisions.');
  const totals = { revisions: 0, publishedRoots: 0, preservedDrafts: 0 };
  for (;;) {
    const progress = await database.transaction(async (transaction) => {
      const sources = await migrationRows<{ id: string }>(
        transaction,
        sql`select r.id from process_revision r where not exists(select 1 from work_template_blueprint_conversion c where c.legacy_process_revision_id=r.id) order by r.id limit ${batchSize} for update of r skip locked`,
      );
      const count = { revisions: 0, publishedRoots: 0, preservedDrafts: 0 };
      for (const source of sources) {
        try {
          const result = await convertRetainedRevision(transaction, source.id);
          count.revisions++;
          count.publishedRoots += result.publishedRoots;
          count.preservedDrafts += result.preservedDrafts;
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : 'Invalid retained graph.';
          // Converter errors contain only fixed validation copy; driver errors may contain private data.
          throw new Error(
            `Blueprint conversion failed for source revision ${source.id}: ${reason.startsWith('Retained') || reason.startsWith('Published retained') || reason.startsWith('Invalid retained') ? reason : 'Source validation failed; inspect the retained graph privately.'}`,
            { cause: error },
          );
        }
      }
      return count;
    });
    if (progress.revisions === 0) return totals;
    totals.revisions += progress.revisions;
    totals.publishedRoots += progress.publishedRoots;
    totals.preservedDrafts += progress.preservedDrafts;
    await options.onBlueprintBatch?.(progress);
  }
}
