import { expect, it } from 'vitest';
import { WorkScheduleForestV2 } from '../src/contracts/work-schedule-forest-v2';
import { compileLegacyScheduleImport } from '../src/schedule-import-compiler';
import { legacyImportFixture } from './schedule-import-fixture';

function document(): unknown {
  const result = compileLegacyScheduleImport(legacyImportFixture());
  if (result.kind !== 'compiled_import') throw new Error('Missing private fixture');
  const {
    source: _source,
    sourceMappings: _mappings,
    selectedWork: _selected,
    ...body
  } = result.candidate;
  return {
    ...body,
    kind: 'forest',
    revision: 2,
    dependencies: [],
    roots: result.candidate.roots.map((root) => ({
      key: root.key,
      draft: {
        kind: 'schedule',
        revision: 1,
        template: root.template,
        root: root.root,
        stepOverrides: root.stepOverrides,
        optionalChoices: root.optionalChoices,
        titlePattern: 'Private work',
        timezone: 'UTC',
      },
    })),
  };
}
it('records only qualified private root placements while leaving physical parent authority to checked preflight', () => {
  const base = WorkScheduleForestV2.parse(document());
  expect(
    WorkScheduleForestV2.safeParse({
      ...base,
      placements: [{ rootKey: 'source', project: { rootKey: 'event', path: [] } }],
    }).success,
  ).toBe(true);
  expect(
    WorkScheduleForestV2.safeParse({
      ...base,
      placements: [{ rootKey: 'source', project: { rootKey: 'hidden', path: [] } }],
    }).success,
  ).toBe(false);
  expect(
    WorkScheduleForestV2.safeParse({
      ...base,
      placements: [{ rootKey: 'source', parentTask: { rootKey: 'source', path: [] } }],
    }).success,
  ).toBe(false);
});
