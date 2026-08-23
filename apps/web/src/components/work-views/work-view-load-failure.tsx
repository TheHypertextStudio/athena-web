'use client';

import { EmptyState } from '@docket/ui/components';
import { RefreshCw } from '@docket/ui/icons';
import type { JSX } from 'react';

/** Props for the shared work-view recovery state. */
export interface WorkViewLoadFailureProps {
  readonly title: string;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}

/** Render a recoverable roster failure without exposing provider or exception text. */
export function WorkViewLoadFailure({
  title,
  retrying,
  onRetry,
}: WorkViewLoadFailureProps): JSX.Element {
  return (
    <div role="alert" className="flex min-h-64 flex-1 items-center justify-center p-6">
      <EmptyState
        frame="none"
        icon={RefreshCw}
        title={`${title} could not load`}
        body="Your filters and display settings are safe. Try loading this list again."
        cta={{
          label: retrying ? 'Trying again' : 'Try again',
          onClick: onRetry,
          disabled: retrying,
        }}
      />
    </div>
  );
}
