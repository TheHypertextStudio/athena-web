'use client';

import { useState } from 'react';

/**
 * A page offset that returns to the first page whenever the filter it belongs to changes.
 *
 * @remarks
 * The offset is stored *with* the filter it was chosen under, and read back only when the two still
 * agree. That makes the reset happen in the same render as the filter change rather than after it.
 *
 * Resetting with a separate `setOffset(0)` beside the filter's own setter — or in an effect keyed on
 * the filter — costs a wasted page load: the offset is part of the query key, so it moves on its own
 * turn and fires a full request for a filter/offset pair nobody asked to see. Deriving it means the
 * key changes once.
 *
 * @param filter - Whatever the current page is a page *of*: a debounced search term, a status, a
 * composite of several. Any change resets the offset to zero.
 * @returns the offset to query with, and a setter that records which filter it belongs to.
 */
export function usePagedOffset(filter: string): readonly [number, (next: number) => void] {
  const [page, setPage] = useState({ filter, offset: 0 });

  const offset = page.filter === filter ? page.offset : 0;

  return [
    offset,
    (next: number) => {
      setPage({ filter, offset: next });
    },
  ];
}
