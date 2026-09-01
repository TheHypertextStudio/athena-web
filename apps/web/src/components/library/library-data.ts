import type { SearchOut, SearchResult } from '../../lib/contracts/search';

import { LIBRARY_KINDS } from './resource-catalog';

/** Number of results requested per Library cursor page. */
export const LIBRARY_PAGE_SIZE = 50;

/** Query parameters shared by the server preload and client cursor fetches. */
export interface LibrarySearchQuery {
  readonly kinds: string;
  readonly limit: string;
  readonly q?: string;
  readonly cursor?: string;
}

/** Build one normalized Library search request. */
export function buildLibrarySearchQuery(
  query: string,
  cursor: string | null | undefined,
): LibrarySearchQuery {
  const normalizedQuery = query.trim();
  return {
    kinds: LIBRARY_KINDS.join(','),
    limit: String(LIBRARY_PAGE_SIZE),
    ...(normalizedQuery ? { q: normalizedQuery } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** Build the cache-key segment for one browse or search result set. */
export function libraryQueryKeyPart(query: string): string {
  return `library:${query.trim()}`;
}

/** Flatten cursor pages without repeating a result returned on two page boundaries. */
export function mergeLibraryPages(pages: readonly SearchOut[]): readonly SearchResult[] {
  const seen = new Set<string>();
  const rows: SearchResult[] = [];
  for (const page of pages) {
    for (const row of page.items) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}
