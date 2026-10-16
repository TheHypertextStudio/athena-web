import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/error';
import {
  listTemplateGallery,
  getTemplateGalleryDetail,
  getTemplateGalleryFork,
} from '../../src/lib/template-gallery/catalog';

describe('curated work definition discovery', () => {
  it('pages the complete release in curated order without duplicate or dropped definitions', () => {
    const slugs: string[] = [];
    let cursor: string | undefined;
    do {
      const page = listTemplateGallery({}, { limit: 13, ...(cursor ? { cursor } : {}) });
      slugs.push(...page.items.map((item) => item.slug));
      cursor = page.nextCursor;
    } while (cursor);
    expect(slugs).toHaveLength(110);
    expect(new Set(slugs).size).toBe(110);
    expect(listTemplateGallery({}, { limit: 100 }).items.map((item) => item.slug)).toEqual(
      slugs.slice(0, 100),
    );
  });
  it('combines fork, kind, category and case-insensitive use search', () => {
    const page = listTemplateGallery(
      { fork: 'nonprofit', targetType: 'project', category: 'events', search: 'EVENT' },
      { limit: 100 },
    );
    expect(page.items.some((item) => item.slug === 'event')).toBe(true);
    expect(
      page.items.every(
        (item) =>
          item.forks.includes('nonprofit') &&
          item.targetType === 'project' &&
          item.category === 'events',
      ),
    ).toBe(true);
    expect(
      listTemplateGallery({ search: 'nothing-matches-this-query' }, { limit: 100 }).items,
    ).toEqual([]);
  });
  it('refuses changed filter cursors and malformed or unknown positions', () => {
    const first = listTemplateGallery({}, { limit: 2 });
    expect(() =>
      listTemplateGallery({ fork: 'personal' }, { limit: 2, cursor: first.nextCursor }),
    ).toThrow(ValidationError);
    expect(() => listTemplateGallery({}, { limit: 2, cursor: 'made-up' })).toThrow(ValidationError);
  });
  it('returns actual catalog identities and complete Program routines without invented workspace versions', () => {
    const program = getTemplateGalleryDetail('event-series');
    expect(program.identity.kind).toBe('catalog');
    expect(program.identity).not.toHaveProperty('organizationId');
    expect(program.identity).not.toHaveProperty('workTypeVersionId');
    expect(program.definition.defaultSchedules.length).toBeGreaterThan(0);
    expect(program.references.some((entry) => entry.slug === 'community-event')).toBe(true);
    expect(program.references.some((entry) => entry.slug === 'workshop')).toBe(true);
    expect(new Set(program.references.map((entry) => entry.slug)).size).toBe(
      program.references.length,
    );
    const event = getTemplateGalleryDetail('event');
    expect(event.references.some((entry) => entry.slug === 'vendor-booking')).toBe(true);
    expect(event.definition.blueprint.steps.map((step) => step.key)).toEqual([
      'book_venue',
      'promote',
      'headcount',
      'run',
      'thank_you',
    ]);
    expect(() => getTemplateGalleryDetail('absent-source')).toThrow(/not found/i);
  });
});

it('selects the whole approved fork even when browsing would require several pages', () => {
  for (const [fork, total] of [
    ['startup', 60],
    ['nonprofit', 47],
    ['agency', 46],
    ['personal', 14],
  ] as const) {
    const result = getTemplateGalleryFork(fork);
    expect(result.items).toHaveLength(total);
    expect(result.items.every((item) => item.forks.includes(fork))).toBe(true);
    expect(new Set(result.items.map((item) => item.slug)).size).toBe(total);
  }
});
