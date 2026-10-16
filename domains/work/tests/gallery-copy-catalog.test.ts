import { describe, expect, it } from 'vitest';
import { GALLERY_CATALOG } from '../src/gallery/catalog';
import { planTemplateCopy } from '../src/gallery/copy-planner';
import { galleryGraph } from './gallery-blueprint-fixture';
import { destination, destinationOrganizationId, ref } from './gallery-copy-fixture';
import { publication } from './blueprint-fixtures';

describe('curated catalog independent copy preparation', () => {
  it('plans every released catalog root with rewritten transitive definitions and actual Program schedules', async () => {
    const sources = GALLERY_CATALOG.map((entry) => ({
      snapshot: galleryGraph(entry).root,
      fingerprint: `catalog:${entry.release}:${entry.versionId}`,
      defaultSchedules: entry.defaultSchedules,
      labelSuggestions: entry.labelSuggestions,
      offeringSuggestions: entry.offeringSuggestions,
    }));
    const destinations = sources.map((source, i) =>
      destination(source.snapshot, 600000 + i * 1000),
    );
    const bases = ['task', 'project', 'program', 'initiative'].map((kind, i) =>
      publication(8000 + i, kind as Parameters<typeof publication>[1]),
    );
    for (const [index, entry] of GALLERY_CATALOG.entries()) {
      const root = sources[index];
      if (!root) throw new Error('Missing checked catalog root');
      const plan = await planTemplateCopy({
        destinationOrganizationId,
        roots: [ref(root.snapshot)],
        sources,
        bases,
        latest: [],
        destinations,
      });
      expect(plan.copies.length, entry.slug).toBeGreaterThan(0);
      const copiedRoot = plan.copies.find((copy) => copy.source.workTypeId === entry.id);
      expect(copiedRoot?.definition.defaultSchedules.length, entry.slug).toBe(
        entry.defaultSchedules.length,
      );
      const copiedPairs = new Set(
        plan.copies.map((copy) => `${copy.workTypeId}:${copy.versionId}`),
      );
      for (const copied of plan.copies) {
        const references = [
          ...copied.definition.blueprint.steps.flatMap((step) =>
            step.template ? [step.template] : [],
          ),
          ...copied.definition.defaultSchedules.map((schedule) => schedule.template),
        ];
        for (const reference of references) {
          expect(reference.selection.kind, entry.slug).toBe('pinned');
          if (reference.selection.kind !== 'pinned') throw new Error('Unfrozen copy reference');
          expect(
            copiedPairs.has(`${reference.workTypeId}:${reference.selection.workTypeVersionId}`),
            entry.slug,
          ).toBe(true);
        }
      }
    }
  });
});
