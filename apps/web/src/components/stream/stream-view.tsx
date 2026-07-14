'use client';

/**
 * `stream` — the controlled feed surface behind both stream routes.
 *
 * @remarks
 * Owns no data (the page hook does): it renders the reused {@link FilterToolbar} over the stream
 * catalog, groups the server-ordered rows (recency by default; by a field when the toolbar groups),
 * handles loading/empty/error, and drives infinite scroll via a sentinel. Cross-org scope shows
 * the workspace chip; the per-workspace firehose omits it.
 */
import { EmptyState } from '@docket/ui/components';
import { Activity } from '@docket/ui/icons';
import type { JSX, ReactNode } from 'react';

import {
  type FieldCatalog,
  findField,
  labelForValue,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
} from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';

import { groupByRecency, type StreamGroup } from './stream-grouping';
import { StreamRow } from './stream-event-row';
import { type StreamEventRow } from './stream-meta';
import { type StreamRowActions } from './stream-event-actions';
import { useInfiniteScrollSentinel } from './use-infinite-scroll-sentinel';

/** Props for {@link StreamView} (fully controlled). */
export interface StreamViewProps {
  readonly scope: 'me' | 'org';
  readonly catalog: FieldCatalog<StreamEventRow>;
  readonly state: ViewState;
  readonly onFiltersChange: (filters: readonly ViewFilterTerm[]) => void;
  readonly onGroupByChange: (groupBy: ViewGroupTerm | null) => void;
  readonly onSortChange: (sort: readonly ViewSortTerm[]) => void;
  readonly events: readonly StreamEventRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => void;
  readonly actions: StreamRowActions;
  readonly resolveOrgName?: (orgId: string) => string;
  readonly onSelect?: (row: StreamEventRow) => void;
  readonly saveSlot?: ReactNode;
  /** Reference time for recency grouping (injectable for tests). */
  readonly now?: Date;
}

/** Group rows by the active group-by field, or by recency when ungrouped. */
function groupRows(
  events: readonly StreamEventRow[],
  state: ViewState,
  catalog: FieldCatalog<StreamEventRow>,
  now: Date,
): StreamGroup[] {
  if (!state.groupBy) return groupByRecency(events, now);
  const field = findField(catalog, state.groupBy.field);
  if (!field) return groupByRecency(events, now);
  const buckets = new Map<string, StreamEventRow[]>();
  for (const row of events) {
    const value = field.accessor(row);
    const key = value === null ? '' : String(value);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(row);
  }
  return [...buckets.entries()].map(([key, rows]) => ({
    label: key === '' ? 'None' : labelForValue(field, key),
    rows,
  }));
}

/** A small loading skeleton for the first page. */
function FeedSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3">
          <div className="bg-surface-container h-9 w-9 shrink-0 animate-pulse rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="bg-surface-container h-3.5 w-2/3 animate-pulse rounded" />
            <div className="bg-surface-container h-3 w-1/3 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The unified Stream surface. */
export function StreamView(props: StreamViewProps): JSX.Element {
  const { scope, events, loading, error } = props;
  const now = props.now ?? new Date();
  const sentinelRef = useInfiniteScrollSentinel(
    props.fetchNextPage,
    props.hasNextPage && !props.isFetchingNextPage,
  );
  const hasFilters = props.state.filters.length > 0;
  const groups = groupRows(events, props.state, props.catalog, now);

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header>
        <h1 className="text-title-large">Stream</h1>
        <p className="text-on-surface-variant text-xs">
          {scope === 'me'
            ? 'Everything across your workspaces, as it happens.'
            : 'Everything happening in this workspace.'}
        </p>
      </header>

      <FilterToolbar
        catalog={props.catalog}
        state={props.state}
        onFiltersChange={props.onFiltersChange}
        onGroupByChange={props.onGroupByChange}
        onSortChange={props.onSortChange}
        {...(props.saveSlot ? { saveSlot: props.saveSlot } : {})}
      />

      {error ? (
        <div
          role="alert"
          className="border-outline-variant text-on-surface-variant flex items-center justify-between rounded-lg border p-4 text-sm"
        >
          <span>{error}</span>
          <button type="button" className="text-[var(--color-primary)]" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      ) : loading && events.length === 0 ? (
        <FeedSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={hasFilters ? 'No events match these filters' : 'Nothing yet'}
          body={
            hasFilters
              ? 'Try removing a filter to widen the stream.'
              : 'Activity will show up here as work happens across your tools.'
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-1">
              <h2 className="text-on-surface-variant px-3 text-xs font-medium">{group.label}</h2>
              {group.rows.map((row) => (
                <StreamRow
                  key={row.id}
                  row={row}
                  scope={scope}
                  {...(props.resolveOrgName
                    ? { orgName: props.resolveOrgName(row.organizationId) }
                    : {})}
                  actions={props.actions}
                  {...(props.onSelect ? { onSelect: props.onSelect } : {})}
                />
              ))}
            </section>
          ))}
          <div ref={sentinelRef} aria-hidden="true" />
          {props.isFetchingNextPage ? (
            <p className="text-on-surface-variant py-2 text-center text-xs">Loading more…</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
