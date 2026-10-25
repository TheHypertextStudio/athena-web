import { describe, expect, it } from 'vitest';
import { GALLERY_CATALOG } from '@docket/work/template-gallery';
import { CatalogVersionId, normalizeCopyDefinition } from '@docket/work/template-copy';
import { galleryStructure } from '@/components/templates/gallery/gallery-structure';
function source(slug: string) {
  const entry = GALLERY_CATALOG.find((item) => item.slug === slug);
  if (!entry) throw new Error('Missing actual catalog fixture.');
  return {
    identity: {
      kind: 'catalog' as const,
      release: 1 as const,
      workTypeId: entry.id,
      catalogVersionId: CatalogVersionId.parse(entry.versionId),
    },
    definition: normalizeCopyDefinition(entry.definition, entry.defaultSchedules),
  };
}
describe('actual catalog work structure', () => {
  it('reads Event venue subtasks from actual Vendor booking source with no fake publication', () => {
    const event = source('event'),
      vendor = source('vendor-booking');
    const nodes = galleryStructure(event.definition, [event, vendor]);
    expect(nodes[0]?.name).toBe('Book venue');
    expect(nodes[0]?.timing).toContain('21 days before Event’s target date');
    expect(nodes[0]?.children.map((child) => child.name)).toEqual([
      'Get quote',
      'Confirm booking',
      'Pay deposit',
    ]);
    expect(nodes[0]?.children[0]?.document).toContain('Checklist');
  });
  it('keeps real milestone and task parentage and rejects missing exact sources', () => {
    const event = source('partnership-event');
    expect(() => galleryStructure(source('event').definition, [])).toThrow(/resolve exactly/);
    const nodes = galleryStructure(event.definition, [event]);
    expect(nodes.some((node) => node.kind === 'milestone')).toBe(true);
  });
  it('keeps repeated templates as distinct display occurrences without changing source data', () => {
    const event = source('event'),
      vendor = source('vendor-booking');
    const before = JSON.stringify([event, vendor]);
    galleryStructure(event.definition, [event, vendor]);
    expect(JSON.stringify([event, vendor])).toBe(before);
  });
});
