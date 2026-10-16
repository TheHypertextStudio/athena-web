import { expect, it } from 'vitest';
import {
  prepareImportedHistoryPage,
  beginImportedHistoryPreparation,
  appendImportedHistoryPage,
  finishImportedHistoryPreparation,
} from '../src/schedule-import-receipt';
import { fixtureValue } from './schedule-field-timing-fixture';
import { historyPageFixture } from './schedule-import-receipt-fixture';
it('retains nullable unproved originals as review and never manufactures accepted execution authority', () => {
  const input = historyPageFixture();
  fixtureValue(input.references[0]).logical = null;
  fixtureValue(input.references[0]).origin = null;
  const page = prepareImportedHistoryPage(input);
  expect(page.execution).toBe('nonexecuting');
  expect(page.issues.map((issue) => issue.code)).toContain('logical_unproved');
  expect(page.references).toEqual(input.references);
  expect(() =>
    prepareImportedHistoryPage({ ...input, acceptedClaim: { actorId: 'fake' } }),
  ).toThrow();
});
it('preserves terminal history beyond500 through bounded contiguous pages with continuation never', () => {
  const source = historyPageFixture(),
    first = prepareImportedHistoryPage(source);
  let state = appendImportedHistoryPage(beginImportedHistoryPreparation(first), first);
  for (let offset = 1; offset < 502; offset++) {
    const input = historyPageFixture(offset);
    input.nextOffset = offset === 501 ? null : offset + 1;
    state = appendImportedHistoryPage(state, prepareImportedHistoryPage(input));
  }
  const receipt = finishImportedHistoryPreparation(state);
  expect(receipt.referenceCount).toBe(502);
  expect(receipt.continuation).toBe('never');
  expect(receipt.kind).toBe('imported_history');
  expect(receipt.originalRootRefs).toEqual(source.originalRootRefs);
});
it('refuses incomplete/noncontiguous or foreign archive pages instead of truncating a receipt', () => {
  const first = prepareImportedHistoryPage(historyPageFixture());
  const state = appendImportedHistoryPage(beginImportedHistoryPreparation(first), first);
  expect(() => finishImportedHistoryPreparation(state)).toThrow();
  expect(() =>
    appendImportedHistoryPage(state, prepareImportedHistoryPage(historyPageFixture(3))),
  ).toThrow();
  const foreign = historyPageFixture(1);
  foreign.identity.externalOccurrenceKey = 'other-provider-key';
  expect(() => appendImportedHistoryPage(state, prepareImportedHistoryPage(foreign))).toThrow();
});

it('reports a repeated actual identity across page boundaries without dropping original history', () => {
  const original = historyPageFixture();
  original.totalReferences = 2;
  const first = prepareImportedHistoryPage(original);
  const state = appendImportedHistoryPage(beginImportedHistoryPreparation(first), first);
  const next = historyPageFixture();
  next.offset = 1;
  next.nextOffset = null;
  next.totalReferences = next.offset + next.references.length;
  const result = appendImportedHistoryPage(state, prepareImportedHistoryPage(next));
  expect(result.reviewIssueCount).toBe(1);
  expect(finishImportedHistoryPreparation(result).referenceCount).toBe(2);
});

it('keeps tombstones exact, diagnoses later replacements, and does not serialize guessed origin/source facts', () => {
  const input = historyPageFixture();
  const reference = fixtureValue(input.references[0]);
  reference.presence = 'tombstone';
  input.actualRows = [];
  expect(prepareImportedHistoryPage(input).issues).toEqual([]);
  const replacement = historyPageFixture();
  fixtureValue(replacement.actualRows[0]).work.id = 'later-same-path';
  expect(prepareImportedHistoryPage(replacement).issues.map((issue) => issue.code)).toContain(
    'replacement_at_path',
  );
  expect(fixtureValue(prepareImportedHistoryPage(replacement).references[0]).work.id).toBe(
    'original-physical-0',
  );
  const mismatch = historyPageFixture();
  fixtureValue(mismatch.actualRows[0]).origin = {
    publicationVersionId: 'different-parent-version',
    blueprintStepId: 'same-looking-key',
  };
  expect(prepareImportedHistoryPage(mismatch).issues.map((issue) => issue.code)).toContain(
    'origin_mismatch',
  );
});
it('denies tenant, exact immediate origin, parent, publication and alias mismatches as reviewable source data', () => {
  const input = historyPageFixture(),
    row = fixtureValue(input.actualRows[0]);
  row.organizationId = 'other-tenant';
  row.parent = null;
  row.publication = null;
  fixtureValue(input.sourceMappings[0]).sourceKey = 'rewritten-key';
  const codes = prepareImportedHistoryPage(input).issues.map((issue) => issue.code);
  expect(codes).toEqual(
    expect.arrayContaining([
      'foreign_tenant',
      'parent_mismatch',
      'publication_mismatch',
      'source_alias_unproved',
    ]),
  );
  expect(prepareImportedHistoryPage(input).references).toEqual(input.references);
});
it('keeps page windows bounded and refuses forged continuation/final-current authority', () => {
  const input = historyPageFixture(),
    reference = fixtureValue(input.references[0]);
  input.references = Array.from({ length: 501 }, () => reference);
  expect(() => prepareImportedHistoryPage(input)).toThrow();
  const invalid = historyPageFixture();
  invalid.nextOffset = 7;
  const page = prepareImportedHistoryPage(invalid);
  expect(() => appendImportedHistoryPage(beginImportedHistoryPreparation(page), page)).toThrow();
  const current = historyPageFixture();
  current.identity.status = 'materialized';
  current.nextOffset = null;
  current.totalReferences = current.references.length;
  const prepared = prepareImportedHistoryPage(current),
    state = appendImportedHistoryPage(beginImportedHistoryPreparation(prepared), prepared);
  expect(() => finishImportedHistoryPreparation(state)).toThrow('registration barrier');
});
it('reports duplicate logical identity across pages even when physical replacement IDs differ', () => {
  const original = historyPageFixture();
  original.totalReferences = 2;
  const first = prepareImportedHistoryPage(original);
  const state = appendImportedHistoryPage(beginImportedHistoryPreparation(first), first);
  const next = historyPageFixture(1);
  next.nextOffset = null;
  next.totalReferences = next.offset + next.references.length;
  const logical = fixtureValue(original.references[0]).logical;
  fixtureValue(next.references[0]).logical = logical;
  fixtureValue(next.actualRows[0]).logical = logical;
  fixtureValue(next.sourceMappings[0]).reference = fixtureValue(logical ?? undefined);
  expect(appendImportedHistoryPage(state, prepareImportedHistoryPage(next)).reviewIssueCount).toBe(
    1,
  );
});
it('keeps a foreign occurrence observation as reviewable instead of accepting its matching source/path', () => {
  const input = historyPageFixture();
  input.actualRows = input.actualRows.map((row) => ({ ...row, occurrenceId: 'other-occurrence' }));
  expect(prepareImportedHistoryPage(input).issues.map((issue) => issue.code)).toContain(
    'foreign_occurrence',
  );
});
it('refuses changing original rootRefs between pages instead of losing historical root identity', () => {
  const first = prepareImportedHistoryPage(historyPageFixture());
  const state = appendImportedHistoryPage(beginImportedHistoryPreparation(first), first);
  const next = historyPageFixture(1);
  next.originalRootRefs = [];
  next.nextOffset = null;
  next.totalReferences = next.offset + next.references.length;
  expect(() => appendImportedHistoryPage(state, prepareImportedHistoryPage(next))).toThrow();
});

it('refuses a premature end-of-history marker using the independently supplied archive reference count', () => {
  const input = historyPageFixture();
  input.nextOffset = null;
  const page = prepareImportedHistoryPage(input);
  expect(() => appendImportedHistoryPage(beginImportedHistoryPreparation(page), page)).toThrow();
});
