import type { ScheduleHistoryImportReview } from '../work-schedule-history-import-proof';
import type {
  ScheduleConversionReceipt,
  ScheduleConversionReview,
} from '../work-schedule-conversion-types';
import type { ImportedHistoryReceipt } from '@docket/work/work-schedule-import-receipt';
import type { AcceptedScheduleClaim } from '@docket/work/work-schedule-claim';
import type { WorkScheduleDraft } from '@docket/work/work-schedule';
import type { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import type { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import type { WorkScheduleRevisionFallback } from '@docket/work/work-schedule-fallback';
import type { NativeScheduleDateOwnership } from './work-schedule-date-ownership';
import { sql } from 'drizzle-orm';
import {
  check,
  type AnyPgColumn,
  bigint,
  integer,
  jsonb,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/** Versioned restricted source archive, independently hashed from the original conversion MD5. */
export interface ScheduleSourceArchive {
  readonly revision: 1;
  readonly source: Readonly<Record<string, unknown>>;
  readonly header: Readonly<Record<string, unknown>>;
  readonly revisionAudit: Readonly<Record<string, unknown>>;
}
/** Complete historical receipt; references remain private and are paginated by the read DAO. */
export interface ScheduleHistoricalArchive {
  readonly revision: 1;
  readonly instance: Readonly<Record<string, unknown>>;
  readonly references: readonly Readonly<Record<string, unknown>>[];
}
/** Private canonical revision data; normalized cadence remains authoritative. */
export function scheduleRevisionColumns() {
  return {
    scheduleDraft: jsonb('schedule_draft').$type<
      WorkScheduleDraft | WorkScheduleForest | WorkScheduleForestV2
    >(),
    authoringFallback: jsonb('authoring_fallback').$type<WorkScheduleRevisionFallback>(),
    conversionReceipt: jsonb('conversion_receipt').$type<ScheduleConversionReceipt>(),
    conversionReceiptHash: text('conversion_receipt_hash'),
    conversionReview: jsonb('conversion_review').$type<ScheduleConversionReview>(),
  };
}
/** Immutable preparation metadata stays separate from executable drafts and retryable private reviews. */
export function scheduleConversionConstraints(t: {
  conversionReceipt: AnyPgColumn;
  conversionReceiptHash: AnyPgColumn;
  conversionReview: AnyPgColumn;
}) {
  return [
    check(
      'schedule_conversion_receipt_shape',
      sql`(${t.conversionReceipt} is null and ${t.conversionReceiptHash} is null) or (${t.conversionReceipt} is not null and ${t.conversionReceiptHash} is not null and ${t.conversionReceiptHash} ~ '^sha256:[a-f0-9]{64}$')`,
    ),
    check(
      'schedule_conversion_review_shape',
      sql`${t.conversionReview} is null or (docket_schedule_keys(${t.conversionReview},ARRAY['kind','revision','execution','code']) and ${t.conversionReview}->>'kind'='schedule_conversion_review' and ${t.conversionReview}->'revision'='1'::jsonb and ${t.conversionReview}->>'execution'='nonexecuting' and ${t.conversionReview}->>'code' in('original_source_unproved','alias_unproved','timezone_unproved','closure_unproved','pending_source','missing_selection','oversized_source','invalid_structure','unsupported_timing'))`,
    ),
  ];
}
/** Durable run claims and conservative nonexecuting historical receipts on the existing occurrence. */
export function scheduleOccurrenceColumns() {
  return {
    runKind: text('run_kind').$type<'scheduled' | 'historical'>().notNull().default('scheduled'),
    legacyInstanceId: text('legacy_instance_id'),
    acceptedClaim: jsonb('accepted_claim').$type<AcceptedScheduleClaim>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptanceOrdinal: bigint('acceptance_ordinal', { mode: 'number' }),
    attempt: integer('attempt').notNull().default(0),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    retryAvailableAt: timestamp('retry_available_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    historicalArchive: jsonb('historical_archive').$type<ScheduleHistoricalArchive>(),
    historicalArchiveHash: text('historical_archive_hash'),
    importedHistoryReceipt: jsonb('imported_history_receipt').$type<ImportedHistoryReceipt>(),
    importedHistoryReceiptHash: text('imported_history_receipt_hash'),
    historyImportReview: jsonb('history_import_review').$type<ScheduleHistoryImportReview>(),
    scheduleDateOwnership:
      jsonb('schedule_date_ownership').$type<readonly NativeScheduleDateOwnership[]>(),
    continuedFromOccurrenceId: text('continued_from_occurrence_id'),
  };
}

/** Historical rows cannot enter the scheduler or acquire accepted execution authority. */
export function scheduleOccurrenceConstraints(t: {
  runKind: AnyPgColumn;
  seriesId: AnyPgColumn;
  seriesRevisionId: AnyPgColumn;
  legacyInstanceId: AnyPgColumn;
  status: AnyPgColumn;
  externalOccurrenceKey: AnyPgColumn;
  acceptedClaim: AnyPgColumn;
  retryAvailableAt: AnyPgColumn;
  attempt: AnyPgColumn;
  importedHistoryReceipt: AnyPgColumn;
  importedHistoryReceiptHash: AnyPgColumn;
  historyImportReview: AnyPgColumn;
  acceptedAt: AnyPgColumn;
  acceptanceOrdinal: AnyPgColumn;
}) {
  return [
    check(
      'schedule_occurrence_run_shape',
      sql`(${t.runKind}='scheduled' and ${t.seriesId} is not null and ${t.seriesRevisionId} is not null) or (${t.runKind}='historical' and ${t.seriesId} is null and ${t.seriesRevisionId} is null and ${t.legacyInstanceId} is not null and ${t.status}::text in('completed','canceled','failed','needs_resolution') and ${t.externalOccurrenceKey} is null and ${t.acceptedClaim} is null and ${t.retryAvailableAt} is null)`,
    ),
    check(
      'schedule_import_history_shape',
      sql`(${t.importedHistoryReceipt} is null and ${t.importedHistoryReceiptHash} is null) or (${t.importedHistoryReceipt} is not null and ${t.importedHistoryReceiptHash} is not null and ${t.importedHistoryReceiptHash} ~ '^sha256:[a-f0-9]{64}$' and ${t.acceptedClaim} is null)`,
    ),
    check(
      'schedule_import_review_shape',
      sql`${t.historyImportReview} is null or (docket_schedule_keys(${t.historyImportReview},ARRAY['kind','revision','execution','code']) and ${t.historyImportReview}->>'kind'='history_import_review' and ${t.historyImportReview}->'revision'='1'::jsonb and ${t.historyImportReview}->>'execution'='nonexecuting' and ${t.historyImportReview}->>'code' in('current_run_requires_barrier','original_source_unproved','history_identity_unproved'))`,
    ),
    check('schedule_occurrence_attempt', sql`${t.attempt}>=0`),
    check(
      'schedule_occurrence_claim_shape',
      sql`(${t.acceptedClaim} is null and ${t.acceptedAt} is null and ${t.acceptanceOrdinal} is null) or (${t.acceptedClaim} is not null and ${t.acceptedAt} is not null and ${t.acceptanceOrdinal}>0)`,
    ),
  ];
}

/** Existing legacy alias remains nullable beside the immutable canonical owning Program. */
export function scheduleSeriesColumns(definitionId: AnyPgColumn) {
  return {
    ownerProgramId: text('owner_program_id'),
    definitionId: text('definition_id').references(() => definitionId, { onDelete: 'cascade' }),
  };
}
