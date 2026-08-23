'use client';

import { Search } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for the shared control that opens contextual in-page search. */
export interface InPageFindButtonProps {
  readonly onClick: () => void;
}

/** Render a touch-accessible Find action without keeping a search field open. */
export function InPageFindButton({ onClick }: InPageFindButtonProps): JSX.Element {
  return (
    <Button type="button" variant="ghost" controlSize="sm" className="gap-1.5" onClick={onClick}>
      <Search aria-hidden className="size-4" />
      Find
    </Button>
  );
}
