'use client';

import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link SchedulingRetryButton}. */
export interface SchedulingRetryButtonProps {
  /** Whether a retry is already in flight; the button is disabled and says so. */
  readonly retrying: boolean;
  /** Start the retry. */
  readonly onRetry: () => void;
}

/**
 * The retry action a scheduling surface offers beside a failed read.
 *
 * @param props - See {@link SchedulingRetryButtonProps}.
 * @returns A small tonal button.
 */
export function SchedulingRetryButton({
  retrying,
  onRetry,
}: SchedulingRetryButtonProps): JSX.Element {
  return (
    <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
      {retrying ? 'Retrying…' : 'Retry'}
    </Button>
  );
}
