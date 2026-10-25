import { sql } from 'drizzle-orm';
import { BlueprintError } from '@docket/work/blueprints';
import type { Database } from './client';
import { hashScheduleArchive } from './work-schedule-archive';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import { proveScheduleConversion } from './work-schedule-conversion-proof';
import type {
  ScheduleConversionReview,
  ScheduleConversionReviewCode,
} from './work-schedule-conversion-types';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Committed revision preparation counts; no count represents activation or execution authority. */
export interface ScheduleConversionProgress {
  readonly prepared: number;
  readonly deferred: number;
}
/** Bounded retryable preparation; every callback runs after the revision transaction commits. */
export interface ScheduleConversionOptions {
  readonly batchSize?: number;
  readonly onScheduleConversionBatch?: (
    progress: ScheduleConversionProgress,
  ) => void | Promise<void>;
}
const codes: readonly ScheduleConversionReviewCode[] = [
  'original_source_unproved',
  'alias_unproved',
  'timezone_unproved',
  'closure_unproved',
  'pending_source',
  'missing_selection',
  'oversized_source',
  'invalid_structure',
  'unsupported_timing',
];
function reason(error: unknown): ScheduleConversionReviewCode | null {
  if (error instanceof BlueprintError)
    return error.code === 'blueprint_limit' ? 'oversized_source' : 'invalid_structure';
  if (!(error instanceof ScheduleSourceProofError)) return null;
  return codes.find((code) => code === error.message) ?? 'original_source_unproved';
}
async function prepare(
  tx: BlueprintMigrationConnection,
  id: string,
): Promise<ScheduleConversionProgress> {
  try {
    const receipt = await proveScheduleConversion(tx, id);
    if (!receipt) return { prepared: 0, deferred: 0 };
    await tx.execute(
      sql`update recurrence_series_revision set conversion_receipt=${JSON.stringify(receipt)}::jsonb,conversion_receipt_hash=${hashScheduleArchive(receipt)},conversion_review=null where id=${id} and conversion_receipt is null`,
    );
    return { prepared: 1, deferred: 0 };
  } catch (error) {
    const code = reason(error);
    if (!code) throw error;
    const review: ScheduleConversionReview = {
      kind: 'schedule_conversion_review',
      revision: 1,
      execution: 'nonexecuting',
      code,
    };
    await tx.execute(
      sql`update recurrence_series_revision set conversion_review=${JSON.stringify(review)}::jsonb where id=${id} and conversion_receipt is null and conversion_review is distinct from ${JSON.stringify(review)}::jsonb`,
    );
    return { prepared: 0, deferred: 1 };
  }
}
async function scan(
  database: Database,
  options: ScheduleConversionOptions,
  size: number,
  pass: number,
): Promise<ScheduleConversionProgress> {
  const totals = { prepared: 0, deferred: 0 };
  let after: string | null = null;
  for (;;) {
    const rows: { id: string }[] = await migrationRows(
      database,
      sql`select id from recurrence_series_revision where process_revision_id is not null and schedule_draft is null and conversion_receipt is null and (${after}::text is null or id>${after}) and (${pass}=0 or conversion_review is null) order by id limit ${size}`,
    );
    if (!rows.length) return totals;
    for (const row of rows) {
      const progress = await database.transaction((tx) => prepare(tx, row.id));
      totals.prepared += progress.prepared;
      totals.deferred += progress.deferred;
      await options.onScheduleConversionBatch?.(progress);
    }
    after = rows.at(-1)?.id ?? null;
  }
}
/**
 * Prepare independently proved revision receipts without drafts, claims, public work or continuation writes.
 * A bounded second scan recovers lower-ID insertions; unresolved rows retry on the next checkpoint.
 * @throws For storage/integrity failures or a post-commit observer interruption; commits survive retry.
 */
export async function backfillScheduleConversions(
  database: Database,
  options: ScheduleConversionOptions = {},
): Promise<ScheduleConversionProgress> {
  const size = options.batchSize ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000)
    throw new RangeError('Conversion batches contain1 through1000 revisions.');
  const totals = { prepared: 0, deferred: 0 };
  for (let pass = 0; pass < 2; pass++) {
    const progress = await scan(database, options, size, pass);
    totals.prepared += progress.prepared;
    totals.deferred += progress.deferred;
  }
  return totals;
}
