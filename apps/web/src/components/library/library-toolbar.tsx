'use client';

import type { SearchResult } from '../../lib/contracts/search';
import { InPageFindButton } from '@/components/in-page-search/in-page-find-button';
import { FilterToolbar, type FilterToolbarProps } from '@/components/views/filter-toolbar';
import { type JSX } from 'react';

import { LibrarySearchFieldComponent, type LibrarySearchFieldProps } from './library-search-field';

/** Controlled inputs for the Library's search and view controls. */
export type LibraryToolbarProps = LibrarySearchFieldProps &
  Pick<
    FilterToolbarProps<SearchResult>,
    'catalog' | 'state' | 'onFiltersChange' | 'onGroupByChange' | 'onSortChange'
  > & { readonly openSearch: () => void };

/** Render the Library's search and view controls. */
export function LibraryToolbar({
  findOpen,
  searchInputRef,
  draft,
  query,
  isFetching,
  resultCount,
  onDraftChange,
  onFindClose,
  restoreFocus,
  catalog,
  state,
  onFiltersChange,
  onGroupByChange,
  onSortChange,
  openSearch,
}: LibraryToolbarProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <LibrarySearchFieldComponent
        findOpen={findOpen}
        searchInputRef={searchInputRef}
        draft={draft}
        query={query}
        isFetching={isFetching}
        resultCount={resultCount}
        onDraftChange={onDraftChange}
        onFindClose={onFindClose}
        restoreFocus={restoreFocus}
      />
      <FilterToolbar
        catalog={catalog}
        state={state}
        onFiltersChange={onFiltersChange}
        onGroupByChange={onGroupByChange}
        onSortChange={onSortChange}
        saveSlot={<InPageFindButton onClick={openSearch} />}
      />
    </div>
  );
}
