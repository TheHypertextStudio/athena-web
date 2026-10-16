import { describe, expect, it } from 'vitest';
import { GALLERY_CATALOG } from '../src/gallery/catalog';
import { GalleryEntry } from '../src/gallery/types';
import { galleryForkInventory } from './gallery-forks-inventory';
import { galleryInventory } from './gallery-inventory';
import { TITLE_MAX } from '../src/task-titles';

describe('complete curated work-template catalog', () => {
  it('contains every approved catalog row and explicit Event/Session/Kickoff once', () => {
    expect(GALLERY_CATALOG).toHaveLength(110);
    expect(
      GALLERY_CATALOG.map((entry) => ({
        slug: entry.slug,
        name: entry.definition.name,
        kind: entry.definition.payload.targetType,
      })).sort((a, b) => a.slug.localeCompare(b.slug)),
    ).toEqual([...galleryInventory].sort((a, b) => a.slug.localeCompare(b.slug)));
    expect(new Set(GALLERY_CATALOG.map((entry) => entry.id)).size).toBe(110);
    expect(new Set(GALLERY_CATALOG.map((entry) => entry.versionId)).size).toBe(110);
  });
  it('validates actual canonical definitions and schedule defaults with contextual documents and bounded titles', () => {
    for (const entry of GALLERY_CATALOG) {
      expect(GalleryEntry.safeParse(entry).success, entry.slug).toBe(true);
      expect(entry.forks).toEqual(
        galleryForkInventory[entry.slug as keyof typeof galleryForkInventory],
      );
      expect(entry.definition.payload.description?.length, entry.slug).toBeGreaterThan(100);
      expect(entry.definition.name.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(
        entry.definition.payload.targetType === 'task'
          ? entry.definition.payload.title
          : entry.definition.payload.name,
      ).toBe(entry.definition.name);
      for (const step of entry.definition.blueprint.steps) {
        const title = step.kind === 'task' ? step.fields.title : step.fields.name;
        expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
        expect(step.fields.description?.length, `${entry.slug}/${step.key}`).toBeGreaterThan(70);
      }
    }
  });
  it('keeps label/team suggestions out of reusable IDs and distinguishes Renewal use cases', () => {
    const bug = GALLERY_CATALOG.find((entry) => entry.slug === 'bug-report');
    const design = GALLERY_CATALOG.find((entry) => entry.slug === 'design-request');
    expect(bug?.labelSuggestions).toEqual(['Bug']);
    expect(design?.offeringSuggestions).toEqual(['Design']);
    expect(bug?.definition.payload).not.toHaveProperty('labelIds');
    expect(design?.definition.payload).not.toHaveProperty('teamId');
    expect(
      GALLERY_CATALOG.filter((entry) => entry.definition.name === 'Renewal')
        .map((entry) => entry.definition.payload.targetType)
        .sort(),
    ).toEqual(['project', 'task']);
  });
  it('keeps released source data immutable while parsed workspace copies remain independently editable', () => {
    const source = GALLERY_CATALOG.find((entry) => entry.slug === 'content-calendar');
    if (!source) throw new Error('Missing Program source');
    expect(Object.isFrozen(source.definition)).toBe(true);
    expect(Object.isFrozen(source.defaultSchedules)).toBe(true);
    expect(() => {
      source.definition.name = 'Changed source';
    }).toThrow();
    const copy = GalleryEntry.parse(source);
    copy.definition.name = 'My editorial program';
    const first = copy.defaultSchedules[0];
    if (!first) throw new Error('Missing copied schedule');
    first.cadence.interval = 2;
    expect(source.definition.name).toBe('Content calendar');
    expect(source.defaultSchedules[0]?.cadence.interval).toBe(1);
  });
});
