import { describe, expect, it } from 'vitest';
import type { GalleryEntry } from '../src/gallery/types';
import { GALLERY_CATALOG } from '../src/gallery/catalog';
import { validateBlueprintGraph, assertAcyclic } from '../src/blueprints/graph';
import { planBlueprint } from '../src/blueprints/rules';
import { reflowBlueprint } from '../src/blueprints/dates';
import { ProgramDefaultSchedule } from '../src/contracts/work-schedule-defaults';
import type { ExistingBlueprintNode } from '../src/blueprints/types';
import { galleryGraph, galleryInput } from './gallery-blueprint-fixture';
function entry(slug: string) {
  const found = GALLERY_CATALOG.find((entry) => entry.slug === slug);
  if (!found) throw new Error('Missing gallery entry');
  return found;
}
function sourceById(id: string): GalleryEntry {
  const target = GALLERY_CATALOG.find((source) => source.id === id);
  if (!target) throw new Error('Missing exact catalog source');
  return target;
}
function catalogTargets(source: GalleryEntry): string[] {
  const targets: string[] = [];
  for (const step of source.definition.blueprint.steps)
    if (step.template) {
      const target = sourceById(step.template.workTypeId);
      expect(target.definition.payload.targetType).toBe(step.kind);
      expect(step.template.selection).toEqual({
        kind: 'pinned',
        workTypeVersionId: target.versionId,
      });
      targets.push(target.id);
    }
  for (const raw of source.defaultSchedules) {
    const schedule = ProgramDefaultSchedule.parse(raw);
    const target = sourceById(schedule.template.workTypeId);
    expect(target.definition.payload.targetType).toBe(schedule.template.targetType);
    expect(schedule.template.selection).toEqual({
      kind: 'pinned',
      workTypeVersionId: target.versionId,
    });
    targets.push(target.id);
  }
  return targets;
}
describe('curated catalog uses the canonical blueprint engine', () => {
  it('validates and expands every complete root with exact referenced definitions under the shared cap', () => {
    for (const source of GALLERY_CATALOG) {
      validateBlueprintGraph(galleryGraph(source));
      const tree = planBlueprint(galleryInput(source));
      expect(tree.nodes.length, source.slug).toBeLessThanOrEqual(500);
      expect(tree.warnings, source.slug).toEqual(
        source.slug === 'quarterly-report'
          ? [{ code: 'waiting_completion', count: 1, paths: [['finish_report']] }]
          : [],
      );
    }
  });
  it('uses exact pinned catalog IDs for children and independently valid Program default schedules', () => {
    const edges = new Map(GALLERY_CATALOG.map((source) => [source.id, catalogTargets(source)]));
    expect(() => {
      assertAcyclic(edges);
    }).not.toThrow();
    expect(entry('content-calendar').defaultSchedules).toHaveLength(2);
    expect(entry('client-engagement').defaultSchedules).toHaveLength(1);
    expect(entry('program-delivery').defaultSchedules).toHaveLength(2);
    expect(entry('event-series').defaultSchedules).toHaveLength(2);
  });
  it('creates Event venue21days before its target and preserves a hand-set deposit when the event moves', () => {
    const input = galleryInput(entry('event'), '2026-10-08');
    const tree = planBlueprint(input);
    const venue = tree.nodes.find((node) => node.path.join('/') === 'book_venue');
    const deposit = tree.nodes.find((node) => node.path.join('/') === 'book_venue/pay_deposit');
    expect(venue?.dates.dueDate).toBe('2026-09-17');
    expect(deposit?.dates.dueDate).toBe('2026-09-16');
    const existing: ExistingBlueprintNode[] = tree.nodes.map((node, i) => ({
      ...node,
      id: `work-${i}`,
      state: 'unstarted',
      everStarted: false,
      cancellable: true,
    }));
    const pinned = existing.map((node) =>
      node.path.join('/') === 'book_venue/pay_deposit'
        ? {
            ...node,
            dates: { dueDate: '2026-09-10' },
            dateBindings: {
              ...node.dateBindings,
              dueDate: node.dateBindings.dueDate
                ? { ...node.dateBindings.dueDate, manual: true }
                : undefined,
            },
          }
        : node,
    );
    const changes = reflowBlueprint({
      nodes: pinned,
      context: input.context,
      anchorChanges: [{ path: [], field: 'targetDate', value: '2026-10-15' }],
    });
    expect(changes.find((change) => change.path.join('/') === 'book_venue')?.value).toBe(
      '2026-09-24',
    );
    expect(changes.some((change) => change.path.join('/') === 'book_venue/pay_deposit')).toBe(
      false,
    );
  });
  it('waits for all three actual quarterly report preparation completions', () => {
    const input = galleryInput(entry('quarterly-report'));
    expect(
      planBlueprint(input).nodes.find((node) => node.path.join('/') === 'finish_report')?.dates
        .dueDate,
    ).toBeNull();
    const completions = ['export_revenue', 'collect_expenses', 'write_outline'].map((key) => ({
      path: [key],
      state: 'completed' as const,
      completedAt: '2026-10-09T12:00:00Z',
    }));
    const partial = planBlueprint({
      ...input,
      context: { ...input.context, completions: completions.slice(0, 2) },
    });
    expect(
      partial.nodes.find((node) => node.path.join('/') === 'finish_report')?.dates.dueDate,
    ).toBeNull();
    const ready = planBlueprint({ ...input, context: { ...input.context, completions } });
    expect(ready.nodes.find((node) => node.path.join('/') === 'finish_report')?.dates.dueDate).toBe(
      '2026-10-09',
    );
  });
  it('places partner guidance inside the Ready to host Milestone with a meaningful relative date', () => {
    const tree = planBlueprint(galleryInput(entry('partnership-event'), '2026-10-08'));
    expect(
      tree.nodes.find((node) => node.path.join('/') === 'ready_to_host')?.dates.targetDate,
    ).toBe('2026-10-06');
    expect(tree.nodes.find((node) => node.path.join('/') === 'partner_guidance')).toMatchObject({
      parentPath: ['ready_to_host'],
      dates: { dueDate: '2026-09-24' },
    });
  });
});
