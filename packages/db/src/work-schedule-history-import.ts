import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { hashScheduleArchive } from './work-schedule-archive';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import { prepareScheduleHistoryPages } from './work-schedule-history-import-pages';
import {
  proveScheduleHistoryImport,
  type ScheduleHistoryImportReview,
  type ScheduleHistoryReviewCode,
} from './work-schedule-history-import-proof';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Committed history preparation counts; reviews grant no execution or continuation authority. */
export interface ScheduleHistoryImportProgress {
  readonly prepared: number;
  readonly deferred: number;
}
/** Resumable bounded history checkpoint; observers run after each committed occurrence transaction. */
export interface ScheduleHistoryImportOptions {
  readonly batchSize?: number;
  readonly onScheduleHistoryImportBatch?: (
    progress: ScheduleHistoryImportProgress,
  ) => void | Promise<void>;
}
function reviewCode(error: ScheduleSourceProofError): ScheduleHistoryReviewCode {
  return error.message === 'current_run_requires_barrier' ||
    error.message === 'history_identity_unproved'
    ? error.message
    : 'original_source_unproved';
}
async function prepareOne(
  tx: BlueprintMigrationConnection,
  id: string,
): Promise<ScheduleHistoryImportProgress> {
  try {
    const proof = await proveScheduleHistoryImport(tx, id);
    if (!proof) return { prepared: 0, deferred: 0 };
    const receipt = await prepareScheduleHistoryPages(tx, proof);
    await tx.execute(
      sql`update process_occurrence set imported_history_receipt=${JSON.stringify(receipt)}::jsonb,imported_history_receipt_hash=${hashScheduleArchive(receipt)},history_import_review=null where id=${id} and imported_history_receipt is null`,
    );
    return { prepared: 1, deferred: 0 };
  } catch (error) {
    if (!(error instanceof ScheduleSourceProofError)) throw error;
    const review: ScheduleHistoryImportReview = {
      kind: 'history_import_review',
      revision: 1,
      execution: 'nonexecuting',
      code: reviewCode(error),
    };
    await tx.execute(
      sql`update process_occurrence set history_import_review=${JSON.stringify(review)}::jsonb where id=${id} and imported_history_receipt is null and history_import_review is distinct from ${JSON.stringify(review)}::jsonb`,
    );
    return { prepared: 0, deferred: 1 };
  }
}
/**
 * Prepare only terminal/history receipts on existing rows, without materialization, activation or completion.
 * A second bounded scan recovers lower-ID insertions; later concurrent writes retry on the next checkpoint.
 * @throws For storage/integrity failures or a post-commit observer interruption. Committed rows survive retry.
 */
export async function backfillScheduleHistoryImports(
  database: Database,
  options: ScheduleHistoryImportOptions = {},
): Promise<ScheduleHistoryImportProgress> {
  const size = options.batchSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new RangeError('History batches contain 1 through 1000 occurrences.');
  const totals = { prepared: 0, deferred: 0 };
  for (let pass = 0; pass < 2; pass++) {
    const progress = await scanHistoryPass(database, options, size, pass);
    totals.prepared += progress.prepared;
    totals.deferred += progress.deferred;
  }
  return totals;
}
async function scanHistoryPass(
  database: Database,
  options: ScheduleHistoryImportOptions,
  size: number,
  pass: number,
): Promise<ScheduleHistoryImportProgress> {
  const totals = { prepared: 0, deferred: 0 };
  let after: string | null = null;
  for (;;) {
    const rows: { id: string }[] = await migrationRows(
      database,
      sql`select id from process_occurrence where legacy_instance_id is not null and historical_archive is not null and imported_history_receipt is null and (${after}::text is null or id>${after}) and (${pass}=0 or history_import_review is null) order by id limit ${size}`,
    );
    if (!rows.length) break;
    for (const row of rows) {
      const progress = await database.transaction((tx) => prepareOne(tx, row.id));
      totals.prepared += progress.prepared;
      totals.deferred += progress.deferred;
      await options.onScheduleHistoryImportBatch?.(progress);
    }
    after = rows.at(-1)?.id ?? null;
  }
  return totals;
}
