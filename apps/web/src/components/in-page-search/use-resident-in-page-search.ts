'use client';

import { type Dispatch, type SetStateAction, useDeferredValue, useMemo, useState } from 'react';

/** A collection whose owner has proved that every searchable item is resident. */
export interface CompleteResidentCollection<T> {
  /** The explicit evidence required before client-side complete-corpus search is allowed. */
  readonly completeness: 'complete';
  /** Every item in the searchable collection. */
  readonly items: readonly T[];
}

/** The controlled result of searching a complete resident collection. */
export interface ResidentInPageSearchResult<T> {
  /** The field value updated at input priority. */
  readonly draft: string;
  /** Update the field value. */
  readonly setDraft: Dispatch<SetStateAction<string>>;
  /** The deferred query represented by {@link ResidentInPageSearchResult.items}. */
  readonly settledQuery: string;
  /** The complete collection subset that matches every normalized term. */
  readonly items: readonly T[];
}

/** Options for {@link useResidentInPageSearch}. */
export interface ResidentInPageSearchOptions<T> {
  /** A source that explicitly guarantees complete residency. */
  readonly source: CompleteResidentCollection<T>;
  /** Return all visible text that makes one item searchable. */
  readonly searchableText: (item: T) => string;
}

function normalizedTerms(query: string): readonly string[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized.length === 0 ? [] : normalized.split(/\s+/);
}

/** Search an explicitly complete resident collection without coupling rendering to data access. */
export function useResidentInPageSearch<T>({
  source,
  searchableText,
}: ResidentInPageSearchOptions<T>): ResidentInPageSearchResult<T> {
  const [draft, setDraft] = useState('');
  const settledQuery = useDeferredValue(draft);
  const terms = useMemo(() => normalizedTerms(settledQuery), [settledQuery]);
  const index = useMemo(
    () =>
      source.items.map((item) => ({
        item,
        text: searchableText(item).toLocaleLowerCase(),
      })),
    [searchableText, source.items],
  );
  const items = useMemo(() => {
    if (terms.length === 0) return source.items;
    return index
      .filter(({ text }) => terms.every((term) => text.includes(term)))
      .map(({ item }) => item);
  }, [index, source.items, terms]);

  return { draft, setDraft, settledQuery, items };
}
