import {
  ImportedHistoryPageInput,
  PreparedImportedHistoryPage,
  ImportedHistoryReceipt,
  type ImportedHistoryIdentity,
} from './contracts/work-schedule-import-receipt';
import type { LegacyScheduleSourceEvidence } from './contracts/work-schedule-import';
import {
  validateImportedHistoryMappings,
  importedHistoryReferenceKeys,
} from './schedule-import-receipt-validation';
/** Internal paged preparation progress; none of these descriptive fields grants runtime authority. */
export interface ImportedHistoryPreparation {
  readonly identity: ImportedHistoryIdentity;
  readonly source: LegacyScheduleSourceEvidence;
  readonly historicalArchiveHash: string;
  readonly originalRootRefs: ImportedHistoryReceipt['originalRootRefs'];
  readonly nextOffset: number | null;
  readonly complete: boolean;
  readonly referenceCount: number;
  readonly totalReferences: number;
  readonly reviewIssueCount: number;
  readonly seenReferenceKeys: ReadonlySet<string>;
}
/** Prepare one bounded original page; uncertain physical/origin data becomes review, never replacement work. */
export function prepareImportedHistoryPage(value: unknown): PreparedImportedHistoryPage {
  const input = ImportedHistoryPageInput.parse(value);
  return PreparedImportedHistoryPage.parse({
    kind: 'prepared_import_page',
    revision: 1,
    execution: 'nonexecuting',
    identity: input.identity,
    source: input.source,
    historicalArchiveHash: input.historicalArchiveHash,
    originalRootRefs: input.originalRootRefs,
    totalReferences: input.totalReferences,
    offset: input.offset,
    nextOffset: input.nextOffset,
    references: input.references,
    issues: validateImportedHistoryMappings(input),
  });
}
/** Start a private complete-history scan from immutable identity/archive pointers, with no500 history ceiling. */
export function beginImportedHistoryPreparation(
  page: PreparedImportedHistoryPage,
): ImportedHistoryPreparation {
  const input = PreparedImportedHistoryPage.parse(page);
  return {
    identity: input.identity,
    source: input.source,
    historicalArchiveHash: input.historicalArchiveHash,
    originalRootRefs: input.originalRootRefs,
    nextOffset: 0,
    complete: false,
    referenceCount: 0,
    totalReferences: input.totalReferences,
    reviewIssueCount: 0,
    seenReferenceKeys: new Set(),
  };
}
function assertPage(state: ImportedHistoryPreparation, page: PreparedImportedHistoryPage): void {
  if (
    state.complete ||
    page.offset !== state.nextOffset ||
    page.totalReferences !== state.totalReferences ||
    JSON.stringify(page.identity) !== JSON.stringify(state.identity) ||
    JSON.stringify(page.source) !== JSON.stringify(state.source) ||
    page.historicalArchiveHash !== state.historicalArchiveHash ||
    JSON.stringify(page.originalRootRefs) !== JSON.stringify(state.originalRootRefs)
  )
    throw new Error('Continue the exact complete original history scan.');
  assertPageWindow(state.totalReferences, page);
}
function assertPageWindow(totalReferences: number, page: PreparedImportedHistoryPage): void {
  if (
    page.nextOffset !== null &&
    (page.references.length === 0 || page.nextOffset !== page.offset + page.references.length)
  )
    throw new Error('History pages must advance by every original reference.');
  if (
    page.offset + page.references.length > totalReferences ||
    (page.nextOffset === null) !== (page.offset + page.references.length === totalReferences)
  )
    throw new Error('History end must match the complete original archive count.');
}
/** Consume a contiguous bounded page, retaining counts/review separately from execution budget or claims. */
export function appendImportedHistoryPage(
  state: ImportedHistoryPreparation,
  value: PreparedImportedHistoryPage,
): ImportedHistoryPreparation {
  const page = PreparedImportedHistoryPage.parse(value);
  assertPage(state, page);
  const keys = page.references.flatMap(importedHistoryReferenceKeys);
  const repeated = page.references.filter((reference) =>
    importedHistoryReferenceKeys(reference).some((key) => state.seenReferenceKeys.has(key)),
  ).length;
  return {
    ...state,
    nextOffset: page.nextOffset,
    complete: page.nextOffset === null,
    referenceCount: state.referenceCount + page.references.length,
    reviewIssueCount: state.reviewIssueCount + page.issues.length + repeated,
    seenReferenceKeys: new Set([...state.seenReferenceKeys, ...keys]),
  };
}
/**
 * Build only a complete noncontinuing historical summary; final database proof/registration remains separate.
 * @throws For incomplete scans or live current runs that require a coordinated writer barrier/adoption.
 */
export function finishImportedHistoryPreparation(
  state: ImportedHistoryPreparation,
): ImportedHistoryReceipt {
  if (!state.complete)
    throw new Error('Read every original history page before recording a summary.');
  if (
    state.identity.runKind !== 'historical' &&
    !['completed', 'canceled', 'skipped'].includes(state.identity.status)
  )
    throw new Error('Current work requires a coordinated registration barrier.');
  return ImportedHistoryReceipt.parse({
    kind: 'imported_history',
    revision: 1,
    execution: 'nonexecuting',
    continuation: 'never',
    identity: state.identity,
    source: state.source,
    historicalArchiveHash: state.historicalArchiveHash,
    referenceCount: state.referenceCount,
    reviewIssueCount: state.reviewIssueCount,
    originalRootRefs: state.originalRootRefs,
  });
}
