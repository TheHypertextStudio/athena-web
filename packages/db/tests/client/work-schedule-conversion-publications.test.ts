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
function connection(...rows: unknown[][]): BlueprintMigrationConnection {
  const execute = vi.fn();
  for (const row of rows) execute.mockResolvedValueOnce(row);
  return { execute };
}
function childPublication(targetType: string): { definition: unknown } {
  return {
    definition: {
      name: 'Child outline',
      payload: { targetType },
      blueprint: { steps: [], dependencies: [] },
    },
  };
}
function withRoot(patch: Partial<ScheduleArchiveSource['manifest']['roots'][number]>) {
  const value = source();
  const [root] = value.manifest.roots;
  if (!root) throw new Error('Fixture root missing.');
  return { ...value, manifest: { ...value.manifest, roots: [{ ...root, ...patch }] } };
}
it('refuses a root without both selected identities before reading publications', async () => {
  const tx = connection();
  await expect(
    readScheduleConversionClosure(tx, 'workspace', withRoot({ workTypeVersionId: null })),
  ).rejects.toThrow('missing_selection');
  expect(tx.execute).not.toHaveBeenCalled();
});
it('refuses an absent or unreadable root publication', async () => {
  await expect(
    readScheduleConversionClosure(connection([]), 'workspace', source()),
  ).rejects.toThrow('closure_unproved');
  await expect(
    readScheduleConversionClosure(connection([{ definition: { name: 1 } }]), 'workspace', source()),
  ).rejects.toThrow('closure_unproved');
});
it('refuses publications whose kind cannot carry a schedule', async () => {
  await expect(
    readScheduleConversionClosure(
      connection([childPublication('initiative')]),
      'workspace',
      source(),
    ),
  ).rejects.toThrow('invalid_structure');
});
it('refuses a root whose publication kind differs from the recorded root', async () => {
  await expect(
    readScheduleConversionClosure(connection([childPublication('task')]), 'workspace', source()),
  ).rejects.toThrow('closure_unproved');
});
it('refuses a pinned child publication of a different kind than its step', async () => {
  await expect(
    readScheduleConversionClosure(
      connection([{ definition: definition(true) }], [childPublication('project')]),
      'workspace',
      source(),
    ),
  ).rejects.toThrow('closure_unproved');
});
it('refuses one version reached through two different work types', async () => {
  const value = source();
  const [root] = value.manifest.roots;
  if (!root) throw new Error('Fixture root missing.');
  const doubled = {
    ...value,
    manifest: {
      ...value.manifest,
      roots: [root, { ...root, key: 'second', sourceStepId: 'second', workTypeId: childId }],
    },
  };
  await expect(
    readScheduleConversionClosure(
      connection([{ definition: definition(true) }], [childPublication('task')]),
      'workspace',
      doubled,
    ),
  ).rejects.toThrow('closure_unproved');
});
it('refuses a nested step without its original order proof', async () => {
  const value = source();
  const nested = {
    ...value,
    manifest: {
      ...value.manifest,
      steps: [{ sourceStepId: 'step', rootKey: 'root', path: ['child'] }],
    },
  } as unknown as ScheduleArchiveSource;
  await expect(
    readScheduleConversionClosure(
      connection([{ definition: definition(true) }], [childPublication('task')]),
      'workspace',
      nested,
    ),
  ).rejects.toThrow('closure_unproved');
  const unmatched = {
    ...nested,
    originalStepOrders: [{ sourceStepId: 'step', sourceVersionId: 'other', key: 'child' }],
  } as unknown as ScheduleArchiveSource;
  await expect(
    readScheduleConversionClosure(
      connection([{ definition: definition(true) }], [childPublication('task')]),
      'workspace',
      unmatched,
    ),
  ).rejects.toThrow('closure_unproved');
});
it('maps proved nested and root steps to their canonical references', async () => {
  const value = source();
  const proved = {
    ...value,
    originalStepOrders: [{ sourceStepId: 'step', sourceVersionId: rootVersion, key: 'child' }],
    manifest: {
      ...value.manifest,
      steps: [
        { sourceStepId: 'root-step', rootKey: 'root', path: [] },
        { sourceStepId: 'step', rootKey: 'root', path: ['child'] },
      ],
    },
  } as unknown as ScheduleArchiveSource;
  const closure = await readScheduleConversionClosure(
    connection([{ definition: definition(true) }], [childPublication('task')]),
    'workspace',
    proved,
  );
  expect([...closure.references]).toEqual([
    ['root-step', { rootKey: 'root', path: [] }],
    ['step', { rootKey: 'root', path: ['child'] }],
  ]);
});
