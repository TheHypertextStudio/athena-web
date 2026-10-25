import { expect, it, vi } from 'vitest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { readScheduleConversionClosure } from '../../src/work-schedule-conversion-publications';
import type { ScheduleArchiveSource } from '../../src/work-schedule-archive-source';
import type { BlueprintMigrationConnection } from '../../src/work-template-blueprint-migration/query';

const rootId = '01K00000000000000000000001',
  rootVersion = '01K00000000000000000000002';
const childId = '01K00000000000000000000003',
  childVersion = '01K00000000000000000000004';
function source(): ScheduleArchiveSource {
  return {
    source: {},
    header: {},
    revisionAudit: {},
    fingerprint: 'a'.repeat(32),
    originalFingerprint: 'a'.repeat(32),
    originalStepOrders: [],
    overrides: [],
    manifest: {
      kind: 'published',
      legacyProcessRevisionId: 'original',
      roots: [
        {
          sourceStepId: 'root',
          sourceKey: 'original-root',
          key: 'root',
          kind: 'project',
          workTypeId: rootId,
          workTypeVersionId: rootVersion,
        },
      ],
      steps: [],
      dependencies: [],
    },
  };
}
function definition(pinned: boolean): WorkTemplateDefinition {
  return WorkTemplateDefinition.parse({
    name: 'Pinned outline',
    payload: { targetType: 'project' },
    blueprint: {
      steps: [
        {
          key: 'child',
          kind: 'task',
          parentStepKey: null,
          sort: 0,
          optional: { enabled: false, selectedByDefault: true },
          template: {
            workTypeId: childId,
            selection: pinned
              ? { kind: 'pinned', workTypeVersionId: childVersion }
              : { kind: 'latest' },
          },
          fields: { title: 'Child' },
          teamRule: 'parent_team',
          actorRule: 'unassigned',
          cycleRule: 'none',
          dates: {},
        },
      ],
      dependencies: [],
    },
  });
}
it('defers nested latest without consulting a current publication or inventing an original closure', async () => {
  const execute = vi.fn().mockResolvedValue([{ definition: definition(false) }]);
  const tx = { execute } as unknown as BlueprintMigrationConnection;
  await expect(readScheduleConversionClosure(tx, 'workspace', source())).rejects.toThrow(
    'closure_unproved',
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it('prepares only exact pinned nested publications without manufacturing inline base identity', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ definition: definition(true) }])
    .mockResolvedValueOnce([
      {
        definition: {
          name: 'Child outline',
          payload: { targetType: 'task' },
          blueprint: { steps: [], dependencies: [] },
        },
      },
    ]);
  const tx = { execute } as unknown as BlueprintMigrationConnection;
  const closure = await readScheduleConversionClosure(tx, 'workspace', source());
  expect(closure.selectedWork).toEqual([
    { reference: { rootKey: 'root', path: [] }, kind: 'project' },
    { reference: { rootKey: 'root', path: ['child'] }, kind: 'task' },
  ]);
  expect(
    closure.publications.map((entry) => [entry.path, entry.workTypeId, entry.versionId]),
  ).toEqual([
    [[], rootId, rootVersion],
    [['child'], childId, childVersion],
  ]);
  expect(execute).toHaveBeenCalledTimes(2);
});
