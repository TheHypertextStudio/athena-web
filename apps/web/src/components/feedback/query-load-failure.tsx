'use client';

/**
 * `components/feedback/query-load-failure` — {@link LoadFailure} wired to the query that failed.
 *
 * @remarks
 * Nearly every failed read renders the same three props from one TanStack query: its `error`, a
 * retry that calls its `refetch`, and its `isFetching` flag. Passing the query keeps each callsite
 * to one line and makes the wiring identical everywhere. A failure that spans several queries
 * (a page that reads three things) passes those props to `LoadFailure` directly.
 */
import type { JSX } from 'react';

import { LoadFailure } from './load-failure';

/** The part of a TanStack query result that {@link QueryLoadFailure} reads. */
export interface QueryFailureSource {
  /** The failure the query settled on. */
  readonly error: unknown;
  /** Whether a request for this query is in flight. */
  readonly isFetching: boolean;
  /** Re-issue the read. */
  readonly refetch: () => unknown;
}

/** Props for {@link QueryLoadFailure}. */
export interface QueryLoadFailureProps {
  /** Surface name, used when the failure carries nothing more specific ("Projects"). */
  readonly title: string;
  /** The query that failed. */
  readonly query: QueryFailureSource;
  /** `region` (default) fills a content area; `panel` is a compact block for a rail or a card. */
  readonly size?: 'region' | 'panel' | undefined;
}

/** A failed read, presented from the query that failed. */
export function QueryLoadFailure({ title, query, size }: QueryLoadFailureProps): JSX.Element {
  return (
    <LoadFailure
      title={title}
      error={query.error}
      onRetry={() => void query.refetch()}
      retrying={query.isFetching}
      size={size}
    />
  );
}
