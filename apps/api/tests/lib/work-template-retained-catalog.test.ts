import { describe, expect, it, vi } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { BlueprintStep, type ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { PublishedBlueprintSnapshot, WorkKind } from '@docket/work/blueprints';
import * as catalog from '../../src/lib/work-template-blueprints/catalog';

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ${String(n).padStart(7, '0')}`;
function publication(
  type: number,
  version: number,
  steps: readonly BlueprintStep[] = [],
): PublishedBlueprintSnapshot {
  return {
    organizationId: OrganizationId.parse(id(1)),
    kind: 'task',
    workTypeId: WorkTypeId.parse(id(type)),
    versionId: WorkTypeVersionId.parse(id(version)),
    stepIds: {},
    definition: WorkTemplateDefinition.parse({
      name: 'Reusable work',
      payload: { targetType: 'task' },
      blueprint: { steps, dependencies: [] },
    }),
  };
}
function step(
  key: string,
  source: PublishedBlueprintSnapshot | null,
  pinned = false,
): BlueprintStep {
  return BlueprintStep.parse({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: key },
    template: source
      ? {
          workTypeId: source.workTypeId,
          selection: pinned
            ? { kind: 'pinned', workTypeVersionId: source.versionId }
            : { kind: 'latest' },
        }
      : null,
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    cycleRule: 'none',
    dates: {},
    optional: { enabled: false, selectedByDefault: true },
  });
}
function resolution(path: string[], source: PublishedBlueprintSnapshot): ResolvedVersionAtPath {
  return { path, workTypeId: source.workTypeId, versionId: source.versionId };
}
function reader(base: PublishedBlueprintSnapshot, rows: readonly PublishedBlueprintSnapshot[]) {
  return vi.fn(
    async (_kind: WorkKind, selection: BlueprintStep['template'], exactVersionId?: string) => {
      const type = selection?.workTypeId ?? base.workTypeId;
      const exact =
        selection?.selection.kind === 'pinned'
          ? selection.selection.workTypeVersionId
          : exactVersionId;
      const selected = [...rows, base].find(
        (row) => row.workTypeId === type && (!exact || row.versionId === exact),
      );
      if (!selected) throw new Error('Exact publication fixture missing');
      return selected;
    },
  );
}

describe('retained accepted publication selection', () => {
  it('retains the accepted latest child after a newer publication while honoring an explicit newer pin', async () => {
    const base = publication(9, 90),
      old = publication(3, 30),
      newer = publication(3, 31);
    const root = publication(2, 20, [step('latest', old), step('pinned', newer, true)]);
    const read = reader(base, [newer, old]);
    const graph = await catalog.resolveRetainedBlueprintCatalog(
      root,
      [resolution([], root), resolution(['latest'], old), resolution(['pinned'], newer)],
      read,
    );
    expect(graph.resolutions).toEqual([resolution(['latest'], old), resolution(['pinned'], newer)]);
  });

  it('uses accepted latest once per type even when an unselected occurrence is visited first', async () => {
    const base = publication(9, 90),
      old = publication(3, 30),
      newer = publication(3, 31);
    const unchecked = step('a_unchecked', old);
    const root = publication(2, 20, [
      { ...unchecked, optional: { enabled: true, selectedByDefault: false } },
      step('z_selected', old),
    ]);
    const read = reader(base, [newer, old]);
    const graph = await catalog.resolveRetainedBlueprintCatalog(
      root,
      [resolution([], root), resolution(['z_selected'], old)],
      read,
    );
    expect(graph.resolutions).toEqual([
      resolution(['a_unchecked'], old),
      resolution(['z_selected'], old),
    ]);
    expect(read.mock.calls.every((call) => call[2] === old.versionId)).toBe(true);
  });

  it('retains accepted inline base identity without expanding that base blueprint', async () => {
    const old = publication(9, 90),
      newer = publication(9, 91, [step('new_base_child', null)]);
    const root = publication(2, 20, [step('inline', null)]);
    const graph = await catalog.resolveRetainedBlueprintCatalog(
      root,
      [resolution([], root), resolution(['inline'], old)],
      reader(newer, [old]),
    );
    expect(graph.resolutions).toEqual([resolution(['inline'], old)]);
  });

  it('refuses inconsistent accepted latest versions rather than treating them as separate pins', async () => {
    const base = publication(9, 90),
      old = publication(3, 30),
      newer = publication(3, 31);
    const root = publication(2, 20, [step('first', old), step('second', old)]);
    await expect(
      catalog.resolveRetainedBlueprintCatalog(
        root,
        [resolution([], root), resolution(['first'], old), resolution(['second'], newer)],
        reader(base, [newer, old]),
      ),
    ).rejects.toMatchObject({ code: 'blueprint_invalid' });
  });

  it('refuses a recorded path that contradicts an immutable explicit pin', async () => {
    const base = publication(9, 90),
      old = publication(3, 30),
      newer = publication(3, 31);
    const root = publication(2, 20, [step('pinned', newer, true)]);
    await expect(
      catalog.resolveRetainedBlueprintCatalog(
        root,
        [resolution([], root), resolution(['pinned'], old)],
        reader(base, [newer, old]),
      ),
    ).rejects.toMatchObject({ code: 'blueprint_invalid' });
  });

  it.each(['unknown-path', 'duplicate-path', 'other-root'] as const)(
    'refuses %s manifest data',
    async (invalid) => {
      const base = publication(9, 90),
        child = publication(3, 30);
      const root = publication(2, 20, [step('child', child)]);
      const manifest = [resolution([], root), resolution(['child'], child)];
      if (invalid === 'unknown-path') manifest.push(resolution(['missing'], child));
      if (invalid === 'duplicate-path') manifest.push(resolution(['child'], child));
      if (invalid === 'other-root') manifest[0] = resolution([], child);
      await expect(
        catalog.resolveRetainedBlueprintCatalog(root, manifest, reader(base, [child])),
      ).rejects.toMatchObject({ code: 'blueprint_invalid' });
    },
  );
});
