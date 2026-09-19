'use client';

/** The Time page's failed-read state for the period a person has selected. */
import type { JSX } from 'react';

import { LoadFailure, type QueryFailureSource } from '@/components/feedback';

/** Props for {@link SelectedTimeFailure}. */
export interface SelectedTimeFailureProps {
  /** The first failure among the reads that feed the selected period. */
  readonly error: unknown;
  /** Every read that feeds the selected period. */
  readonly queries: readonly QueryFailureSource[];
}

/**
 * The selected period could not load, so the page has nothing to show in its place.
 *
 * @param props - See {@link SelectedTimeFailureProps}.
 * @returns a region failure whose retry re-issues each read that failed.
 */
export function SelectedTimeFailure({ error, queries }: SelectedTimeFailureProps): JSX.Element {
  return (
    <LoadFailure
      title="Your selected time"
      error={error}
      onRetry={() => {
        for (const query of queries) {
          if (query.error) void query.refetch();
        }
      }}
      retrying={queries.some((query) => query.isFetching)}
    />
  );
}
