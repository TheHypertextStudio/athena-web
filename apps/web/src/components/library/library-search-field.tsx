'use client';

import { type JSX } from 'react';

import { InPageSearchField } from '@/components/in-page-search/in-page-search-field';

/** Props for the Library search field. */
export interface LibrarySearchFieldProps {
  readonly findOpen: boolean;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly draft: string;
  readonly query: string;
  readonly isFetching: boolean;
  readonly resultCount: number;
  readonly onDraftChange: (value: string) => void;
  readonly onFindClose: () => void;
  readonly restoreFocus: () => void;
}

/** Search field component. */
export function LibrarySearchFieldComponent({
  findOpen,
  searchInputRef,
  draft,
  query,
  isFetching,
  resultCount,
  onDraftChange,
  onFindClose,
  restoreFocus,
}: LibrarySearchFieldProps): JSX.Element | null {
  if (!findOpen) return null;
  return (
    <InPageSearchField
      inputRef={searchInputRef}
      value={draft}
      onValueChange={onDraftChange}
      onEscapeEmpty={() => {
        onFindClose();
        restoreFocus();
      }}
      label="Search the Library"
      placeholder="Search Library"
      resultCount={resultCount}
      pending={draft.trim() !== query || isFetching}
    />
  );
}
