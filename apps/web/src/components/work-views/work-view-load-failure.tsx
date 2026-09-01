'use client';

import { EmptyState } from '@docket/ui/components';
import { RefreshCw } from '@docket/ui/icons';
import type { JSX } from 'react';

/** Props for the shared work-view recovery state. */
export interface WorkViewLoadFailureProps {
  readonly title: string;
  readonly retrying: boolean;
  /** A local failure never displaces roster rows that the person can still use. */
  readonly hasCachedRows?: boolean;
  readonly onRetry: () => void;
}

/** Render a recoverable roster failure without exposing provider or exception text. */
export function WorkViewLoadFailure({
  title,
  retrying,
  hasCachedRows = false,
  onRetry,
}: WorkViewLoadFailureProps): JSX.Element {
  if (hasCachedRows) return <></>;
  return (
    <div role="alert" className="flex min-h-64 flex-1 items-center justify-center p-6">
      <EmptyState
        frame="none"
        icon={RefreshCw}
        title={`${title} could not load`}
        cta={{
          label: retrying ? 'Retrying' : 'Retry',
          onClick: onRetry,
          disabled: retrying,
        }}
      />
    </div>
  );
}
