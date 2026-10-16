import { expect, it } from 'vitest';
import { compileLegacyScheduleImport } from '../src/schedule-import-compiler';
import {
  CanonicalImportedSchedule,
  LegacyScheduleImportInput,
} from '../src/contracts/work-schedule-import';
import { deriveScheduleFieldTiming } from '../src/schedule-field-timing';
import { normalizeLegacyScheduleCompletionFacts } from '../src/schedule-legacy-completion';
import { fixtureValue } from './schedule-field-timing-fixture';
import { legacyImportFixture } from './schedule-import-fixture';
it('compiles original sort/aliases, all title patterns and exact authored Task completion independently from template-only children', () => {
  const input = legacyImportFixture(),
    before = JSON.stringify(input),
    result = compileLegacyScheduleImport(input);
  expect(result.kind).toBe('compiled_import');
  if (result.kind !== 'compiled_import') throw new Error('Expected candidate');
  const value = result.candidate;
  expect(JSON.stringify(input)).toBe(before);
  expect(value.roots.map((root) => root.key)).toEqual(['source', 'event']);
  expect(value.sourceMappings.map((row) => row.sourceKey)).toEqual([
    '0legacy-source',
    'old-event',
    'follow',
  ]);
  expect(value.titlePolicy).toEqual({ kind: 'legacy_title', revision: 1 });
  expect(value.titles.map((title) => title.pattern)).toEqual([
    'Email {month}',
    'Dinner {monthName}',
    'Follow {date}',
  ]);
  expect(value.completionPolicy.tasks).toEqual([
    { rootKey: 'source', path: [] },
    { rootKey: 'event', path: ['follow'] },
  ]);
  expect(value.absentFields).toEqual([
    { rootKey: 'source', path: [], field: 'startDate' },
    { rootKey: 'event', path: [], field: 'targetDate' },
    { rootKey: 'event', path: ['follow'], field: 'startDate' },
  ]);
  expect(value.roots[1]?.root.fields.description).toBe('');
  expect(value.roots[1]?.root.responsibleActorId).toBeNull();
  expect(
    CanonicalImportedSchedule.safeParse({ ...value, acceptedClaim: { actorId: 'fake' } }).success,
  ).toBe(false);
});
it('reuses actual completion derivation and explicit run-offset precedence without native default dates', () => {
  const input = legacyImportFixture();
  fixtureValue(input.steps[2]).fieldOverrides['due_offset_days'] = 5;
  const result = compileLegacyScheduleImport(input);
  if (result.kind !== 'compiled_import') throw new Error('Expected candidate');
  const actualMappings = [
    { reference: { rootKey: 'source', path: [] }, kind: 'task' as const, id: 'actual-source' },
  ];
  const fields = deriveScheduleFieldTiming({
    timing: result.candidate.timing,
    selections: result.candidate.selectedWork,
    dates: [],
    pins: [],
    actualMappings,
    completionFacts: normalizeLegacyScheduleCompletionFacts(actualMappings, [
      { kind: 'task', id: 'actual-source', completedAt: '2026-11-05T07:30:00Z' },
    ]),
    runDate: '2026-11-01',
    timezone: 'America/Los_Angeles',
    workingWeekdays: [1, 2, 3, 4, 5],
  });
  expect(fields.map((field) => [field.target.rootKey, field.target.field, field.value])).toEqual([
    ['source', 'dueDate', '2026-11-01'],
    ['event', 'startDate', '2026-11-06'],
    ['event', 'dueDate', '2026-11-06'],
  ]);
});
it('preserves empty/null pending bodies and unsupported offsets without pretending publication or acceptance', () => {
  const input = legacyImportFixture();
  input.state = 'pending_draft';
  input.roots = [];
  input.steps = [];
  input.sourceMappings = [];
  input.selectedWork = [];
  const result = compileLegacyScheduleImport(input);
  expect(result).toEqual({
    kind: 'nonexecuting_import',
    pending: {
      kind: 'pending_private_definition',
      revision: 1,
      disposition: 'pending_source',
      source: input,
    },
  });
  const bad = legacyImportFixture();
  fixtureValue(bad.steps[1]).timing = { kind: 'relative_to_trigger', offsetDays: 36501 };
  expect(compileLegacyScheduleImport(bad)).toMatchObject({
    kind: 'nonexecuting_import',
    pending: { disposition: 'unsupported_timing', source: bad },
  });
});
it('refuses missing/latest selections, ambiguous aliases/paths and forged caller authority', () => {
  const input = legacyImportFixture();
  fixtureValue(input.roots[0]).template = null;
  expect(compileLegacyScheduleImport(input)).toMatchObject({
    kind: 'nonexecuting_import',
    pending: { disposition: 'missing_selection' },
  });
  const latest = legacyImportFixture();
  fixtureValue(fixtureValue(latest.roots[0]).template ?? undefined).selection = { kind: 'latest' };
  expect(compileLegacyScheduleImport(latest)).toMatchObject({
    kind: 'nonexecuting_import',
    pending: { disposition: 'missing_selection' },
  });
  const duplicate = legacyImportFixture();
  fixtureValue(duplicate.sourceMappings[1]).alias = 'old-task';
  expect(compileLegacyScheduleImport(duplicate)).toMatchObject({
    kind: 'nonexecuting_import',
    pending: { disposition: 'invalid_structure' },
  });
  expect(() =>
    compileLegacyScheduleImport({ ...legacyImportFixture(), actorId: 'fake' }),
  ).toThrow();
  expect(
    LegacyScheduleImportInput.safeParse({ ...legacyImportFixture(), accepted: true }).success,
  ).toBe(false);
});
it('counts full selected closure at500 without truncating larger nonexecuting source data', () => {
  const input = legacyImportFixture();
  for (let i = input.selectedWork.length; i < 500; i++)
    input.selectedWork.push({
      kind: 'task',
      reference: { rootKey: 'event', path: [`extra-${i}`] },
    });
  expect(compileLegacyScheduleImport(input).kind).toBe('compiled_import');
  input.selectedWork.push({ kind: 'task', reference: { rootKey: 'event', path: ['extra-500'] } });
  const result = compileLegacyScheduleImport(input);
  expect(result).toMatchObject({
    kind: 'nonexecuting_import',
    pending: { disposition: 'oversized_source' },
  });
  if (result.kind === 'nonexecuting_import')
    expect(result.pending.source.selectedWork).toHaveLength(501);
});

it('refuses an incomplete logical selected closure without confusing physical parent existence with completion timing', () => {
  const input = legacyImportFixture();
  input.selectedWork.push({
    kind: 'task',
    reference: { rootKey: 'event', path: ['missing', 'child'] },
  });
  expect(compileLegacyScheduleImport(input)).toMatchObject({
    kind: 'nonexecuting_import',
    pending: { disposition: 'invalid_structure' },
  });
});
