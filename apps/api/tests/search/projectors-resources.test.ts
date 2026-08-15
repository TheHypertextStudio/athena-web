/**
 * `externalResourceSearchProjector` — how a link someone pasted into prose becomes a search row.
 *
 * @remarks
 * These rows are the one corpus nobody authors: `reconcileMentions` writes an `external_resource`
 * the first time a Drive file or a web page is referenced, so every field the Library renders is
 * derived rather than entered. That makes the derivations the behavior worth pinning — a resource
 * with no unfurled title still has to be findable and still has to be visibly *not* named, and
 * freshness has to come from the provider rather than from our own retry clock.
 */
import { describe, expect, it } from 'vitest';

import { externalResourceSearchProjector } from '../../src/search/projectors/resources';

const BASE_ROW = {
  id: 'res-1',
  organizationId: 'org-1',
  provider: 'figma',
  canonicalKey: 'figma:file:abc',
  canonicalUrl: 'https://figma.com/file/abc/Board',
  externalId: 'abc',
  resourceType: 'design',
  title: 'Brand board',
  description: 'The current brand board.',
  siteName: null,
  iconUrl: null,
  thumbnailUrl: null,
  mimeType: null,
  ownerLabel: null,
  externalUpdatedAt: null,
  unfurlStatus: 'resolved',
};

/** Project one row, asserting the projector produced a document at all. */
async function project(over: Partial<typeof BASE_ROW> & Record<string, unknown> = {}) {
  const doc = await externalResourceSearchProjector.project({
    entityId: 'res-1',
    row: { ...BASE_ROW, ...over },
  });
  if (!doc) throw new Error('the resource projector returned no document');
  return doc;
}

describe('title resolution', () => {
  it('indexes the unfurled title and records that it is a real name', async () => {
    const doc = await project({ title: '  Brand board  ' });
    expect(doc.title).toBe('Brand board');
    expect(doc.facet).toMatchObject({ titleResolved: true });
  });

  it('stands in host and path for a resource whose title has not been unfurled', async () => {
    // Not a fabricated name: a reader must be able to tell an un-unfurled row from a named one,
    // and `search_document.title` is NOT NULL so it cannot simply be left empty.
    const doc = await project({ title: null });
    expect(doc.title).toBe('figma.com/file/abc/Board');
    expect(doc.facet).toMatchObject({ titleResolved: false });
  });

  it('treats a whitespace-only title as unresolved rather than indexing blank', async () => {
    const doc = await project({ title: '   ' });
    expect(doc.title).toBe('figma.com/file/abc/Board');
    expect(doc.facet).toMatchObject({ titleResolved: false });
  });

  it('drops a bare root path so the stand-in reads as a site, not a slash', async () => {
    const doc = await project({ title: null, canonicalUrl: 'https://example.com/' });
    expect(doc.title).toBe('example.com');
  });

  it('falls back to the raw value when the canonical URL will not parse', async () => {
    const doc = await project({ title: null, canonicalUrl: 'not a url' });
    expect(doc.title).toBe('not a url');
  });
});

describe('source system attribution', () => {
  it('maps a provider that really is an event source', async () => {
    const doc = await project({ provider: 'google_drive' });
    expect(doc.sourceSystem).toBe('google_drive');
  });

  it('leaves the source system null for providers Docket ingests no events from', async () => {
    // The provider still rides on the facet, so nothing loses attribution by being unmapped.
    const doc = await project({ provider: 'dropbox' });
    expect(doc.sourceSystem).toBeNull();
    expect(doc.facet).toMatchObject({ provider: 'dropbox' });
  });
});

describe('display metadata on the facet', () => {
  it('carries every present display field so a Library row needs no second round trip', async () => {
    const doc = await project({
      iconUrl: 'https://cdn/icon.png',
      thumbnailUrl: 'https://cdn/thumb.png',
      siteName: 'Figma',
      ownerLabel: 'Ada',
      mimeType: 'application/pdf',
    });
    expect(doc.facet).toMatchObject({
      iconUrl: 'https://cdn/icon.png',
      thumbnailUrl: 'https://cdn/thumb.png',
      siteName: 'Figma',
      ownerLabel: 'Ada',
      mimeType: 'application/pdf',
    });
  });

  it('omits absent display fields rather than carrying nulls a renderer must re-check', async () => {
    const doc = await project();
    for (const key of ['iconUrl', 'thumbnailUrl', 'siteName', 'ownerLabel', 'mimeType']) {
      expect(doc.facet).not.toHaveProperty(key);
    }
  });
});

describe('freshness', () => {
  const external = new Date('2026-03-01T00:00:00.000Z');
  const updated = new Date('2026-04-01T00:00:00.000Z');
  const created = new Date('2026-01-01T00:00:00.000Z');

  it("prefers the provider's own timestamp over our retry clock", async () => {
    // `updatedAt` moves every time an unfurl retries, which would float untouched resources to the
    // top of a recency-ordered Library.
    const doc = await project({
      externalUpdatedAt: external,
      updatedAt: updated,
      createdAt: created,
    });
    expect(doc.sourceUpdatedAt).toBe(external);
  });

  it('falls back to our own update time when the provider reports none', async () => {
    const doc = await project({ externalUpdatedAt: null, updatedAt: updated, createdAt: created });
    expect(doc.sourceUpdatedAt).toBe(updated);
  });

  it('falls back to creation when the row has never been updated', async () => {
    const doc = await project({ externalUpdatedAt: null, updatedAt: null, createdAt: created });
    expect(doc.sourceUpdatedAt).toBe(created);
  });

  it('reports no freshness at all rather than inventing one', async () => {
    const doc = await project({ externalUpdatedAt: null, updatedAt: null, createdAt: null });
    expect(doc.sourceUpdatedAt).toBeNull();
  });
});

describe('visibility and lifecycle', () => {
  it('is visible to the whole organization, because disclosure in prose is what created it', async () => {
    const doc = await project();
    expect(doc.visibility).toEqual({ mode: 'org_members' });
    expect(doc.userId).toBeNull();
  });

  it('carries an archive stamp through so an archived resource can be filtered out', async () => {
    const archivedAt = new Date('2026-05-01T00:00:00.000Z');
    expect((await project({ archivedAt })).archivedAt).toBe(archivedAt);
    expect((await project()).archivedAt).toBeNull();
  });

  it('summarizes from the provider description and indexes no body it does not have', async () => {
    const doc = await project({ description: '  The current brand board.  ' });
    expect(doc.summary).toBe('The current brand board.');
    expect(doc.body).toBeNull();
  });
});
