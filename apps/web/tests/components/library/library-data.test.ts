import { describe, expect, it } from 'vitest';
import type { SearchOut, SearchResult } from '@docket/types';

import { buildLibrarySearchQuery, mergeLibraryPages } from '@/components/library/library-data';

function result(id: string): SearchResult {
  return {
    id,
    organizationId: null,
    userId: null,
    kind: 'external_resource',
    family: 'content',
    title: id,
    summary: null,
    snippet: null,
    matchedFields: [],
    route: { type: 'external', externalUrl: `https://example.com/${id}` },
    subject: null,
    source: null,
    facets: {},
    actions: [],
    score: 0,
    entityId: id,
    externalUrl: `https://example.com/${id}`,
    usedIn: [],
    updatedAt: '2026-08-20T12:00:00.000Z',
  };
}

function page(items: readonly SearchResult[], nextCursor?: string): SearchOut {
  return { query: '', items: [...items], facets: [], ...(nextCursor ? { nextCursor } : {}) };
}

describe('Library cursor accumulation', () => {
  it('builds the shared 50-row browse and search cursor request', () => {
    expect(buildLibrarySearchQuery('', null)).toEqual({
      kinds: 'external_resource,attachment',
      limit: '50',
    });
    expect(buildLibrarySearchQuery(' launch ', 'next-page')).toEqual({
      kinds: 'external_resource,attachment',
      limit: '50',
      q: 'launch',
      cursor: 'next-page',
    });
  });

  it('preserves page order and suppresses a row repeated across cursor boundaries', () => {
    expect(
      mergeLibraryPages([
        page([result('one'), result('two')], 'next'),
        page([result('two'), result('three')]),
      ]).map((row) => row.id),
    ).toEqual(['one', 'two', 'three']);
  });
});
