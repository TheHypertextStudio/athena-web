import { describe, expect, it } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import { ProspectiveCopyCatalog } from '../src/gallery/copy-prospective-source';
import { step, ulid } from './blueprint-fixtures';
import {
  prospectiveSource,
  prospectiveInput,
  prospectiveBinding,
  prospectiveReference,
} from './gallery-prospective-fixture';
function fixture(kind: 'draft' | 'publication' | 'catalog' = 'draft') {
  const child = prospectiveSource(2, 'task', [], kind);
  const root = prospectiveSource(
    3,
    'project',
    [step('child', 'task', { template: prospectiveReference(child) })],
    kind,
  );
  return { root, child, binding: prospectiveBinding(root, child) };
}
describe('authorized frozen source normalization', () => {
  it('resolves revision-zero private children only through their exact checked current reservation', () => {
    const f = fixture();
    const input = prospectiveInput([f.root, f.child], [f.binding]);
    const { reservation, ...unreserved } = f.binding;
    if (!reservation) throw new Error('Missing reservation');
    const catalog = new ProspectiveCopyCatalog(input);
    expect(catalog.resolve(f.root, f.binding.slot).identity).toEqual(f.child.identity);
    expect(
      () =>
        new ProspectiveCopyCatalog({
          ...input,
          bindings: [unreserved],
        }),
    ).toThrow('checked current reservation');
    expect(
      () =>
        new ProspectiveCopyCatalog({
          ...input,
          bindings: [{ ...f.binding, reservation: { ...reservation, draftRevision: 1 } }],
        }),
    ).toThrow();
    expect(catalog.require(f.root.identity)).not.toHaveProperty('snapshot');
    expect(catalog.require(f.root.identity)).not.toHaveProperty('stepIds');
  });
  it('supports a draft root referencing an actual publication without publishing the root', () => {
    const child = prospectiveSource(2, 'task', [], 'publication');
    const root = prospectiveSource(3, 'project', [
      step('child', 'task', { template: prospectiveReference(child) }),
    ]);
    const catalog = new ProspectiveCopyCatalog(
      prospectiveInput([root, child], [prospectiveBinding(root, child)]),
    );
    expect(catalog.resolve(root, { kind: 'blueprint_step', key: 'child' }).identity.kind).toBe(
      'publication',
    );
    expect(catalog.require(root.identity).identity.kind).toBe('draft');
  });
  it('rejects a publication falsely resolving its authored pin to an unpublished draft', () => {
    const f = fixture();
    const root = prospectiveSource(3, 'project', f.root.definition.blueprint.steps, 'publication');
    expect(
      () =>
        new ProspectiveCopyCatalog(
          prospectiveInput([root, f.child], [prospectiveBinding(root, f.child)]),
        ),
    ).toThrow('actual publications');
  });
  it('permits an authorized exact archived pin but refuses archived latest', () => {
    const f = fixture('publication');
    const child = { ...f.child, archived: true };
    expect(
      new ProspectiveCopyCatalog(prospectiveInput([f.root, child], [f.binding])).require(
        child.identity,
      ).archived,
    ).toBe(true);
    const root = {
      ...f.root,
      definition: WorkTemplateDefinition.parse({
        ...f.root.definition,
        blueprint: {
          steps: [
            step('child', 'task', {
              template: { workTypeId: child.identity.workTypeId, selection: { kind: 'latest' } },
            }),
          ],
          dependencies: [],
        },
      }),
    };
    expect(
      () =>
        new ProspectiveCopyCatalog(
          prospectiveInput([root, child], [prospectiveBinding(root, child)]),
        ),
    ).toThrow('Archived');
  });
  it('correlates catalog release and actual tenant independently of matching raw IDs', () => {
    const f = fixture('catalog');
    expect(
      new ProspectiveCopyCatalog(prospectiveInput([f.root, f.child], [f.binding])).resolve(
        f.root,
        f.binding.slot,
      ).identity.kind,
    ).toBe('catalog');
    const foreign = { ...f.child, identity: { ...f.child.identity, release: 2 } };
    expect(
      () =>
        new ProspectiveCopyCatalog(
          prospectiveInput([f.root, foreign], [prospectiveBinding(f.root, foreign)]),
        ),
    ).toThrow('namespace');
    const t = fixture('publication');
    const other = {
      ...t.child,
      identity: { ...t.child.identity, organizationId: OrganizationId.parse(ulid(77)) },
    };
    expect(
      () =>
        new ProspectiveCopyCatalog(
          prospectiveInput([t.root, other], [prospectiveBinding(t.root, other)]),
        ),
    ).toThrow('namespace');
  });
  it('rejects contradictory exact facts and unknown authored reservation slots', () => {
    const f = fixture();
    const input = prospectiveInput([f.root, f.child], [f.binding]);
    expect(
      () =>
        new ProspectiveCopyCatalog({
          ...input,
          sources: [
            ...input.sources,
            {
              ...f.child,
              definition: WorkTemplateDefinition.parse({
                name: 'Contradiction',
                payload: { targetType: 'task' },
              }),
            },
          ],
        }),
    ).toThrow('Conflicting duplicate');
    expect(
      () =>
        new ProspectiveCopyCatalog({
          ...input,
          bindings: [{ ...f.binding, slot: { kind: 'blueprint_step', key: 'not_authored' } }],
        }),
    ).toThrow('Unknown authored');
  });
});
