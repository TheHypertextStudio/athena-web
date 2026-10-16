import { expect, it } from 'vitest';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { WorkTypeVersionId } from '@docket/work/ids';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { libraryWorkOrder } from '@/components/templates/gallery/work-template-library-order';
import { galleryFixture } from './gallery-fixture';
function work(n: number, targetType: 'task' | 'project' | 'program' = 'task') {
  return WorkTemplateOut.parse({
    id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`,
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    targetType,
    status: 'draft',
    scope: 'personal',
    ownerActorId: null,
    teamId: null,
    isBase: false,
    revision: 0,
    definition: { name: `Work ${n}`, payload: { targetType } },
    offeredTeamIds: [],
    latestVersion: null,
    pendingPublication: {
      reservedFirstVersionId: `01ARZ3NDEKTSV4RRFFQ69G5F${String(n + 10).padStart(2, '0')}`,
    },
    canEdit: true,
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
  });
}
function step(child: WorkTemplateOut, sort = 0, optional = false) {
  return BlueprintStep.parse({
    ...galleryFixture('event').definition.blueprint.steps[0],
    key: `child_${sort}`,
    sort,
    optional: { enabled: optional, selectedByDefault: true },
    template: {
      workTypeId: child.id,
      selection: {
        kind: 'pinned',
        workTypeVersionId: child.pendingPublication?.reservedFirstVersionId,
      },
    },
  });
}
it('orders exact pending relationships by authored sibling order rather than input array or name', () => {
  const parent = work(1),
    first = work(2),
    second = work(3);
  parent.definition.blueprint.steps = [step(second, 2), step(first, 0)];
  expect(libraryWorkOrder([second, first, parent], 'authoring').map((row) => row.item.id)).toEqual([
    parent.id,
    first.id,
    second.id,
  ]);
});
it('keeps shared same-ID aliases under both actual consumers with unique keys', () => {
  const a = work(1),
    b = work(2),
    child = work(3);
  a.definition.blueprint.steps = [step(child)];
  b.definition.blueprint.steps = [step(child)];
  const rows = libraryWorkOrder([child, a, b], 'authoring');
  expect(rows.filter((row) => row.item.id === child.id).map((row) => row.relationship)).toEqual([
    'Needed by Work 1',
    'Needed by Work 2',
  ]);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
});
it('leaves missing, older-version, foreign and wrong-kind references unresolved instead of inventing a relationship', () => {
  const parent = work(1),
    child = work(2),
    foreign = work(3),
    wrong = work(4, 'project');
  foreign.organizationId = WorkTemplateOut.shape.organizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAY');
  const old = step(child);
  if (old.template?.selection.kind === 'pinned')
    old.template.selection.workTypeVersionId = WorkTypeVersionId.parse(
      '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
    );
  parent.definition.blueprint.steps = [old, step(foreign, 1), step(wrong, 2)];
  expect(
    libraryWorkOrder([parent, child, foreign, wrong], 'authoring').every((row) => row.depth === 0),
  ).toBe(true);
});
it('cuts editable cycles and promotes a matching descendant when its parent is filtered out', () => {
  const a = work(1),
    b = work(2);
  a.definition.blueprint.steps = [step(b)];
  b.definition.blueprint.steps = [step(a)];
  const rows = libraryWorkOrder([a, b], 'authoring');
  expect(rows.length).toBeLessThanOrEqual(4);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  expect(libraryWorkOrder([b], 'authoring')[0]).toMatchObject({ depth: 0, relationship: null });
});
it('keeps actual published relationships separate from authorized unpublished edits', () => {
  const parent = work(1),
    child = work(2);
  parent.draftDefinition = {
    ...parent.definition,
    blueprint: { steps: [step(child)], dependencies: [] },
  };
  expect(libraryWorkOrder([parent, child], 'authoring')[1]?.relationship).toBe('Needed by Work 1');
  expect(libraryWorkOrder([parent, child], 'published')[1]?.relationship).toBeNull();
});
it('distinguishes optional included work and independent recurring work from required dependencies', () => {
  const parent = work(1, 'program'),
    child = work(2),
    routine = work(3, 'project');
  parent.definition.blueprint.steps = [step(child, 0, true)];
  const saved = galleryFixture('client-engagement').definition.defaultSchedules[0];
  if (!saved || !routine.pendingPublication) throw new Error('Missing actual routine reservation.');
  parent.definition.defaultSchedules = [
    {
      ...saved,
      template: {
        ...saved.template,
        workTypeId: routine.id,
        selection: {
          kind: 'pinned',
          workTypeVersionId: routine.pendingPublication.reservedFirstVersionId,
        },
      },
    },
  ];
  expect(
    libraryWorkOrder([parent, child, routine], 'authoring').map((row) => row.relationship),
  ).toEqual([null, 'Included in Work 1', 'Recurring for Work 1']);
});
