import type {
  ImportedHistoryPageInput,
  ImportedHistoricalReference,
  ImportedActualWorkObservation,
  ImportedHistoryReviewIssue,
} from './contracts/work-schedule-import-receipt';
function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function physical(work: { kind: string; id: string }): string {
  return JSON.stringify([work.kind, work.id]);
}
function aliases(input: ImportedHistoryPageInput, reference: ImportedHistoricalReference): boolean {
  if (reference.sourceStepAlias === null && reference.sourceKey === null) return true;
  const matches = input.sourceMappings.filter(
    (mapping) => mapping.alias === reference.sourceStepAlias,
  );
  const mapping = matches[0];
  return (
    matches.length === 1 &&
    mapping?.sourceKey === reference.sourceKey &&
    mapping.kind === reference.work.kind &&
    equal(mapping.reference, reference.logical)
  );
}
function observedIssues(
  reference: ImportedHistoricalReference,
  row: ImportedActualWorkObservation,
): ImportedHistoryReviewIssue['code'][] {
  const issues: ImportedHistoryReviewIssue['code'][] = [];
  if (!equal(reference.logical, row.logical)) issues.push('logical_mismatch');
  if (!equal(reference.parent, row.parent)) issues.push('parent_mismatch');
  if (reference.logical?.path.length) {
    if (!reference.origin) issues.push('origin_unproved');
    else if (!equal(reference.origin, row.origin)) issues.push('origin_mismatch');
  }
  if (reference.work.kind !== 'milestone') {
    if (!reference.publication) issues.push('publication_unproved');
    else if (!equal(reference.publication, row.publication)) issues.push('publication_mismatch');
  }
  return issues;
}
function referenceIssues(
  input: ImportedHistoryPageInput,
  reference: ImportedHistoricalReference,
): ImportedHistoryReviewIssue['code'][] {
  const issues: ImportedHistoryReviewIssue['code'][] = [];
  if (!reference.logical) issues.push('logical_unproved');
  if (!aliases(input, reference)) issues.push('source_alias_unproved');
  const rows = input.actualRows.filter((row) => physical(row.work) === physical(reference.work));
  if (rows.length > 1) issues.push('ambiguous_reference');
  const row = rows[0];
  if (reference.presence === 'tombstone') {
    if (row) issues.push('tombstone_conflict');
    return issues;
  }
  if (!row) {
    issues.push(
      input.actualRows.some(
        (actual) => reference.logical !== null && equal(actual.logical, reference.logical),
      )
        ? 'replacement_at_path'
        : 'missing_actual',
    );
    return issues;
  }
  if (row.organizationId !== input.identity.organizationId) issues.push('foreign_tenant');
  if (row.occurrenceId === null) issues.push('occurrence_unproved');
  else if (row.occurrenceId !== input.identity.occurrenceId) issues.push('foreign_occurrence');
  return [...issues, ...observedIssues(reference, row)];
}
/** Internal duplicate keys for exact physical, logical and original source identities; never execution IDs. */
export function importedHistoryReferenceKeys(
  reference: ImportedHistoricalReference,
): readonly string[] {
  return [
    `work:${physical(reference.work)}`,
    ...(reference.logical
      ? [`logical:${JSON.stringify([reference.logical.rootKey, reference.logical.path])}`]
      : []),
    ...(reference.sourceStepAlias === null ? [] : [`alias:${reference.sourceStepAlias}`]),
  ];
}
/** Preserve uncertain original references while identifying actual identity/origin mismatches; never rebound by key/path. */
export function validateImportedHistoryMappings(
  input: ImportedHistoryPageInput,
): ImportedHistoryReviewIssue[] {
  const seen = new Set<string>();
  return input.references.flatMap((reference, index) => {
    const issues = referenceIssues(input, reference),
      keys = importedHistoryReferenceKeys(reference);
    if (keys.some((key) => seen.has(key))) issues.push('ambiguous_reference');
    for (const key of keys) seen.add(key);
    return [...new Set(issues)].map((code) => ({ position: input.offset + index, code }));
  });
}
