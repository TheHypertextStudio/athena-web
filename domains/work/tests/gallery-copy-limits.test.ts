import { describe, expect, it } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeVersionId } from '../src/ids';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import { ProgramDefaultSchedules } from '../src/contracts/work-schedule-defaults';
import { planTemplateCopy } from '../src/gallery/copy-planner';
import { publication, step, ulid } from './blueprint-fixtures';
import { base, destination, destinationOrganizationId, ref, source } from './gallery-copy-fixture';

function bundle(snapshots: ReturnType<typeof publication>[]) {
  return {
    destinationOrganizationId,
    roots: snapshots.map(ref),
    sources: snapshots.map(source),
    bases: [base],
    latest: [],
    destinations: snapshots.map((snapshot, index) => destination(snapshot, 200000 + index)),
  };
}
function schedule(child: ReturnType<typeof publication>) {
  return ProgramDefaultSchedules.parse([
    {
      key: 'weekly',
      name: 'Weekly',
      template: {
        targetType: 'task',
        workTypeId: child.workTypeId,
        selection: { kind: 'pinned', workTypeVersionId: child.versionId },
      },
      titlePattern: '{month} Report',
      cadence: {
        kind: 'weekly',
        interval: 1,
        startOffsetDays: 0,
        end: { kind: 'never' },
        weekdays: ['monday'],
      },
      teamRule: 'parent_team',
      actorRule: 'creator',
    },
  ]);
}
describe('bounded copy closure validation', () => {
  it('accepts exactly100 definitions and rejects the101st before planning writes', async () => {
    const snapshots = Array.from({ length: 101 }, (_, i) => publication(1000 + i, 'task'));
    expect((await planTemplateCopy(bundle(snapshots.slice(0, 100)))).copies).toHaveLength(100);
    await expect(planTemplateCopy(bundle(snapshots))).rejects.toThrow('100 distinct definitions');
  });
  it('accepts500 expanded work nodes and rejects501 through the canonical engine', async () => {
    const root = publication(
      3,
      'project',
      Array.from({ length: 499 }, (_, i) => step(`child_${i}`, 'task', { sort: i })),
    );
    expect((await planTemplateCopy(bundle([root]))).copies).toHaveLength(1);
    const child = publication(2, 'task', [step('nested')]);
    const oversized = publication(4, 'project', [
      ...root.definition.blueprint.steps.slice(0, 498),
      step('extra', 'task', {
        sort: 498,
        template: {
          workTypeId: child.workTypeId,
          selection: { kind: 'pinned', workTypeVersionId: child.versionId },
        },
      }),
    ]);
    await expect(planTemplateCopy(bundle([oversized, child]))).rejects.toThrow('500 work rows');
  });
  it('bounds aggregate dependency edges across otherwise small independent roots', async () => {
    const steps = Array.from({ length: 10 }, (_, i) => step(`child_${i}`, 'task', { sort: i }));
    const edges = steps.flatMap((blocked, i) =>
      steps
        .slice(0, i)
        .map((blocker) => ({ blockerStepKey: blocker.key, blockedStepKey: blocked.key })),
    );
    const snapshots = Array.from({ length: 45 }, (_, i) =>
      publication(1000 + i, 'project', steps, i === 44 ? edges.slice(0, 20) : edges),
    );
    expect((await planTemplateCopy(bundle(snapshots))).copies).toHaveLength(45);
    const tooMany = [
      ...snapshots.slice(0, 44),
      publication(1044, 'project', steps, edges.slice(0, 21)),
    ];
    await expect(planTemplateCopy(bundle(tooMany))).rejects.toThrow('2000 dependency edges');
  });
  it('rejects cycles and conflicting exact source facts while accepting identical duplicates', async () => {
    const first = publication(2, 'task'),
      second = publication(3, 'task');
    const cycle = {
      ...first,
      definition: WorkTemplateDefinition.parse({
        ...first.definition,
        blueprint: {
          steps: [
            step('again', 'task', {
              template: {
                workTypeId: first.workTypeId,
                selection: { kind: 'pinned', workTypeVersionId: first.versionId },
              },
            }),
          ],
          dependencies: [],
        },
      }),
    };
    await expect(planTemplateCopy(bundle([cycle]))).rejects.toThrow(/cycle|loop/i);
    const input = bundle([first, second]);
    expect(
      (await planTemplateCopy({ ...input, sources: [...input.sources, source(first)] })).copies,
    ).toHaveLength(2);
    await expect(
      planTemplateCopy({
        ...input,
        sources: [
          ...input.sources,
          source({
            ...first,
            definition: WorkTemplateDefinition.parse({
              name: 'Conflicting',
              payload: { targetType: 'task' },
            }),
          }),
        ],
      }),
    ).rejects.toThrow('Conflicting duplicate');
  });
  it('requires one frozen latest resolution and refuses missing publications or reused destination identities', async () => {
    const child = publication(2, 'task'),
      v2 = { ...child, versionId: WorkTypeVersionId.parse(ulid(222)) };
    const root = publication(3, 'project', [
      step('child', 'task', {
        template: { workTypeId: child.workTypeId, selection: { kind: 'latest' } },
      }),
    ]);
    const input = bundle([root, child, v2]);
    await expect(planTemplateCopy(input)).rejects.toThrow('Missing frozen latest');
    await expect(planTemplateCopy({ ...input, latest: [ref(child), ref(v2)] })).rejects.toThrow(
      'Ambiguous frozen latest',
    );
    await expect(planTemplateCopy({ ...bundle([root]), latest: [ref(child)] })).rejects.toThrow(
      'Missing exact source',
    );
    await expect(
      planTemplateCopy({
        ...bundle([child]),
        destinations: [{ ...ref(child), source: ref(child) }],
      }),
    ).rejects.toThrow('distinct independent copies');
  });
  it.each(['tenant', 'kind'])(
    'checks independent default-schedule %s correlation',
    async (mismatch) => {
      const child = publication(2, mismatch === 'kind' ? 'project' : 'task');
      const invalid =
        mismatch === 'tenant'
          ? { ...child, organizationId: OrganizationId.parse(ulid(777)) }
          : child;
      const root = publication(3, 'program');
      const input = bundle([root, invalid]);
      await expect(
        planTemplateCopy({
          ...input,
          sources: [{ ...source(root), defaultSchedules: schedule(child) }, source(invalid)],
        }),
      ).rejects.toThrow(/workspace|kind/);
    },
  );
});
