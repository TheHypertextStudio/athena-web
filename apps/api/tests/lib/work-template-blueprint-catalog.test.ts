import { describe, expect, it, vi } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStepId, WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import { expandBlueprint, type PublishedBlueprintSnapshot } from '@docket/work/blueprints';
import {
  resolveBlueprintCatalog,
  type BlueprintPublicationReader,
} from '../../src/lib/work-template-blueprints/catalog';

const id = (n: number) => `01ARZ3NDEKTSV4RRFFQ${String(n).padStart(7, '0')}`;
function snapshot(n: number, steps: readonly BlueprintStep[] = []): PublishedBlueprintSnapshot {
  return {
    organizationId: OrganizationId.parse(id(1)),
    kind: 'task',
    workTypeId: WorkTypeId.parse(id(n)),
    versionId: WorkTypeVersionId.parse(id(n + 1000)),
    definition: WorkTemplateDefinition.parse({
      name: `Template ${n}`,
      payload: { targetType: 'task' },
      blueprint: { steps, dependencies: [] },
    }),
    stepIds: Object.fromEntries(
      steps.map((step, index) => [step.key, BlueprintStepId.parse(id(n * 1000 + index))]),
    ),
  };
}
function child(key: string, source: PublishedBlueprintSnapshot | null): BlueprintStep {
  return BlueprintStep.parse({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: key },
    optional: { enabled: false, selectedByDefault: true },
    template: source ? { workTypeId: source.workTypeId, selection: { kind: 'latest' } } : null,
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    cycleRule: 'none',
    dates: {},
  });
}

describe('authorized blueprint publication catalog', () => {
  it('freezes repeated latest references once while qualifying each nested instance', async () => {
    const base = snapshot(9);
    const nested = snapshot(3, [child('prepare', null)]);
    const root = snapshot(2, [child('first', nested), child('second', nested)]);
    const read = vi.fn<BlueprintPublicationReader>(async (_kind, selection) =>
      selection ? nested : base,
    );
    const graph = await resolveBlueprintCatalog(root, read);
    expect(read).toHaveBeenCalledTimes(2);
    expect(graph.resolutions.map((entry) => entry.path)).toEqual([
      ['first'],
      ['first', 'prepare'],
      ['second'],
      ['second', 'prepare'],
    ]);
    expect(graph.publications).toHaveLength(2);
    expect(graph.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('resolves an inline base identity without expanding its own children', async () => {
    const base = snapshot(9, [child('base_child', null)]);
    const root = snapshot(2, [child('inline', null)]);
    const read = vi.fn(async () => base);
    const graph = await resolveBlueprintCatalog(root, read);
    expect(graph.resolutions.map((entry) => entry.path)).toEqual([['inline']]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rejects an identity loop before recursively querying the same publication', async () => {
    const placeholder = snapshot(2);
    const root = snapshot(2, [child('again', placeholder)]);
    const read = vi.fn(async () => root);
    await expect(resolveBlueprintCatalog(root, read)).rejects.toMatchObject({
      code: 'blueprint_loop',
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rejects an authorized lookup that returns a foreign workspace or wrong kind', async () => {
    const root = snapshot(2, [child('inline', null)]);
    const foreign = { ...snapshot(9), organizationId: OrganizationId.parse(id(8)) };
    await expect(resolveBlueprintCatalog(root, async () => foreign)).rejects.toMatchObject({
      code: 'blueprint_invalid',
    });
    await expect(
      resolveBlueprintCatalog(root, async () => ({ ...snapshot(9), kind: 'project' })),
    ).rejects.toMatchObject({ code: 'blueprint_invalid' });
  });

  it('bounds transitive publication expansion before reading an oversized closure', async () => {
    const base = snapshot(9);
    const nested = snapshot(
      3,
      Array.from({ length: 499 }, (_, n) => child(`child_${n}`, null)),
    );
    const root = snapshot(2, [child('nested', nested)]);
    await expect(
      resolveBlueprintCatalog(
        root,
        async (_kind, selection) => (selection ? nested : base),
        'publication',
      ),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
  });

  it('permits a one-row creation when its unchecked optional transitive branch grew above500', async () => {
    const base = snapshot(9);
    const nested = snapshot(
      3,
      Array.from({ length: 499 }, (_, n) => child(`child_${n}`, null)),
    );
    const optional = child('optional', nested);
    const root = snapshot(2, [
      { ...optional, optional: { enabled: true, selectedByDefault: false } },
    ]);
    const graph = await resolveBlueprintCatalog(root, async (_kind, selection) =>
      selection ? nested : base,
    );
    expect(expandBlueprint(graph, []).nodes.filter((node) => node.selected)).toHaveLength(1);
  });

  it('counts only selected prerequisites at creation while publication validates all edges', async () => {
    const base = snapshot(9);
    const steps = Array.from({ length: 100 }, (_, n) => ({
      ...child(`child_${n}`, null),
      optional: { enabled: true, selectedByDefault: false },
    }));
    const dependencies = steps
      .flatMap((blocker, n) =>
        steps
          .slice(n + 1)
          .map((blocked) => ({ blockerStepKey: blocker.key, blockedStepKey: blocked.key })),
      )
      .slice(0, 1950);
    const root = snapshot(2, steps);
    root.definition.blueprint.dependencies = dependencies;
    const graph = await resolveBlueprintCatalog(root, async () => base);
    expect(expandBlueprint(graph, []).nodes.filter((node) => node.selected)).toHaveLength(1);
    await expect(
      resolveBlueprintCatalog(root, async () => base, 'publication'),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
  });
});
