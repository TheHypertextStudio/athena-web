import { expect, it } from 'vitest';
import { CanonicalPrivateWorkDefinition } from '../src/contracts/work-private-definition';
import { compileLegacyScheduleImport } from '../src/schedule-import-compiler';
import { legacyImportFixture } from './schedule-import-fixture';
import { WorkScheduleForestV2 } from '../src/contracts/work-schedule-forest-v2';
import { WorkScheduleDraft } from '../src/contracts/work-schedule';
import { WorkScheduleRevisionOut } from '../src/contracts/work-schedule-management';

function published(): unknown {
  const result = compileLegacyScheduleImport(legacyImportFixture());
  if (result.kind !== 'compiled_import') throw new Error('Missing candidate');
  const { source: _source, selectedWork: _selected, ...body } = result.candidate;
  return {
    ...body,
    kind: 'private_definition',
    revision: 1,
    dependencies: [],
    authoring: {
      kind: 'process_definition',
      revision: 1,
      definitionAlias: 'new-head',
      revisionAlias: 'new-revision',
      definition: { name: 'Original private authoring', creationMode: 'when_ready', tasks: [] },
    },
  };
}
it('keeps a fresh private publication timezone-neutral and independent of original SQL rows or MD5 receipts', () => {
  const value = CanonicalPrivateWorkDefinition.parse(published());
  expect(value).toMatchObject({
    kind: 'private_definition',
    revision: 1,
    state: 'published',
    creationMode: 'when_ready',
  });
  for (const extra of [
    { timezone: 'UTC' },
    { legacyProcessRevisionId: 'invented-source' },
    { originalFingerprint: 'a'.repeat(32) },
    { acceptedClaim: {} },
  ])
    expect(CanonicalPrivateWorkDefinition.safeParse({ ...value, ...extra }).success).toBe(false);
});
it('preserves empty or unresolved pending authoring without inventing selected publications', () => {
  const source = CanonicalPrivateWorkDefinition.parse(published());
  const pending = {
    ...source,
    state: 'pending_draft',
    roots: [],
    sourceMappings: [],
    timing: { kind: 'field_timing', revision: 2, rules: [] },
    absentFields: [],
    titles: [],
    completionPolicy: { kind: 'legacy_authored_tasks', revision: 1, tasks: [] },
  };
  expect(CanonicalPrivateWorkDefinition.parse(pending)).toEqual(pending);
  expect(CanonicalPrivateWorkDefinition.safeParse({ ...pending, state: 'published' }).success).toBe(
    false,
  );
  const unresolved = {
    ...source,
    state: 'pending_draft',
    roots: source.roots.map((root) => ({ ...root, template: null, root: null })),
  };
  expect(CanonicalPrivateWorkDefinition.parse(unresolved)).toEqual(unresolved);
  expect(
    CanonicalPrivateWorkDefinition.safeParse({ ...unresolved, state: 'published' }).success,
  ).toBe(false);
});

it('keeps bound v2 semantics readable through the existing authorized revision output contract', () => {
  const definition = CanonicalPrivateWorkDefinition.parse(published());
  const { sourceMappings: _aliases, authoring: _authoring, ...body } = definition;
  const document = WorkScheduleForestV2.parse({
    ...body,
    kind: 'forest',
    revision: 2,
    roots: definition.roots.map((root) => {
      if (!root.root || !root.template) throw new Error('Missing published selection');
      return {
        key: root.key,
        draft: WorkScheduleDraft.parse({
          kind: 'schedule',
          revision: 1,
          template: root.template,
          root: root.root,
          stepOverrides: root.stepOverrides,
          optionalChoices: root.optionalChoices,
          titlePattern: 'Private work',
          timezone: 'America/Los_Angeles',
        }),
      };
    }),
  });
  expect(
    WorkScheduleRevisionOut.safeParse({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      number: 1,
      effectiveFrom: '2026-10-08',
      document,
      trigger: { kind: 'manual' },
      createdAt: '2026-10-08T00:00:00.000Z',
    }).success,
  ).toBe(true);
});
