import { z } from 'zod';
import { BlueprintCivilDate } from './work-template-blueprint';
import { WorkScheduleTimingRef } from './work-schedule-field-timing';
import { LegacyScheduleSourceEvidence, LegacyScheduleSourceMapping } from './work-schedule-import';
/** Original physical work identity; it carries neither current access nor occurrence authority. */
export const ImportedWorkIdentity = z.strictObject({
  kind: z.enum(['task', 'project', 'program', 'milestone']),
  id: z.string().min(1),
});
/** Original actual work identity value. */
export type ImportedWorkIdentity = z.infer<typeof ImportedWorkIdentity>;
/** Immediate real canonical origin pair, distinct from a child's own selected template publication. */
export const ImportedImmediateOrigin = z.strictObject({
  publicationVersionId: z.string().min(1),
  blueprintStepId: z.string().min(1),
});
/** Immediate actual origin value; a missing original pair remains null and unproved. */
export type ImportedImmediateOrigin = z.infer<typeof ImportedImmediateOrigin>;
const publication = z.strictObject({ workTypeId: z.string().min(1), versionId: z.string().min(1) });
/** Exact old run/provider/instance identity, retained independently from any native accepted claim. */
export const ImportedHistoryIdentity = z.strictObject({
  organizationId: z.string().min(1),
  occurrenceId: z.string().min(1),
  seriesId: z.string().nullable(),
  seriesRevisionId: z.string().nullable(),
  instanceAlias: z.string().min(1),
  externalOccurrenceKey: z.string().nullable(),
  scheduledFor: BlueprintCivilDate,
  originalScheduledFor: BlueprintCivilDate.nullable(),
  runKind: z.enum(['scheduled', 'historical']),
  status: z.enum([
    'expected',
    'materialized',
    'completed',
    'canceled',
    'failed',
    'skipped',
    'needs_resolution',
  ]),
});
/** Original saved identity metadata only. */
export type ImportedHistoryIdentity = z.infer<typeof ImportedHistoryIdentity>;
/** Complete raw historical reference plus nullable independently proved mapping/origin facts. */
export const ImportedHistoricalReference = z.strictObject({
  sourceStepAlias: z.string().nullable(),
  sourceKey: z.string().nullable(),
  logical: WorkScheduleTimingRef.nullable(),
  work: ImportedWorkIdentity,
  presence: z.enum(['live', 'tombstone']),
  parent: ImportedWorkIdentity.nullable(),
  origin: ImportedImmediateOrigin.nullable(),
  publication: publication.nullable(),
  original: z.json(),
});
/** History reference value; uncertain facts are retained rather than assigned guessed identities. */
export type ImportedHistoricalReference = z.infer<typeof ImportedHistoricalReference>;
/** Current actual row observation supplied by a separately checked read, never by raw source-key lookup. */
export const ImportedActualWorkObservation = z.strictObject({
  // Read-scope metadata from the checked occurrence query, not a column on public work.
  occurrenceId: z.string().min(1).nullable(),
  organizationId: z.string().min(1),
  work: ImportedWorkIdentity,
  logical: WorkScheduleTimingRef.nullable(),
  parent: ImportedWorkIdentity.nullable(),
  origin: ImportedImmediateOrigin.nullable(),
  publication: publication.nullable(),
});
/** Current same-occurrence read projection; registration must separately prove its database provenance. */
export type ImportedActualWorkObservation = z.infer<typeof ImportedActualWorkObservation>;
const archiveHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pageFields = {
  identity: ImportedHistoryIdentity,
  source: LegacyScheduleSourceEvidence,
  historicalArchiveHash: archiveHash,
  originalRootRefs: z.json(),
  totalReferences: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  references: z.array(ImportedHistoricalReference).max(500),
};
/** Bounded private original-history page; all pages must be consumed before a summary is complete. */
export const ImportedHistoryPageInput = z.strictObject({
  ...pageFields,
  sourceMappings: z.array(LegacyScheduleSourceMapping).max(500),
  actualRows: z.array(ImportedActualWorkObservation).max(1000),
});
/** Private page preparation input. */
export type ImportedHistoryPageInput = z.infer<typeof ImportedHistoryPageInput>;
/** Stable review issue; uncertain data cannot authorize a replacement, continuation or date write. */
export const ImportedHistoryReviewIssue = z.strictObject({
  position: z.number().int().nonnegative(),
  code: z.enum([
    'logical_unproved',
    'source_alias_unproved',
    'ambiguous_reference',
    'foreign_tenant',
    'foreign_occurrence',
    'occurrence_unproved',
    'missing_actual',
    'replacement_at_path',
    'tombstone_conflict',
    'logical_mismatch',
    'parent_mismatch',
    'origin_unproved',
    'origin_mismatch',
    'publication_unproved',
    'publication_mismatch',
  ]),
});
/** Private counted uncertainty value, never raw provider/error text. */
export type ImportedHistoryReviewIssue = z.infer<typeof ImportedHistoryReviewIssue>;
/** Nonexecuting prepared page; descriptive source evidence cannot be upgraded by adding claim fields. */
export const PreparedImportedHistoryPage = z.strictObject({
  ...pageFields,
  kind: z.literal('prepared_import_page'),
  revision: z.literal(1),
  execution: z.literal('nonexecuting'),
  issues: z.array(ImportedHistoryReviewIssue),
});
/** Prepared history metadata only; a writer barrier and database registration are still required for live work. */
export type PreparedImportedHistoryPage = z.infer<typeof PreparedImportedHistoryPage>;
/** Final history-only metadata summary; referenceCount is intentionally independent of the500 creation cap. */
export const ImportedHistoryReceipt = z.strictObject({
  kind: z.literal('imported_history'),
  revision: z.literal(1),
  execution: z.literal('nonexecuting'),
  continuation: z.literal('never'),
  identity: ImportedHistoryIdentity,
  source: LegacyScheduleSourceEvidence,
  historicalArchiveHash: archiveHash,
  referenceCount: z.number().int().nonnegative(),
  reviewIssueCount: z.number().int().nonnegative(),
  originalRootRefs: z.json(),
});
/** History-only summary value; parsing or building it confers no accepted occurrence authority. */
export type ImportedHistoryReceipt = z.infer<typeof ImportedHistoryReceipt>;
