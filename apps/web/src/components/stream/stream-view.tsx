'use client';

/** `stream` — the controlled, context-wide chronological timeline surface. */
import { EmptyState } from '@docket/ui/components';
import { Activity } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  type FieldCatalog,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
} from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';

import { StreamEpisodeView } from './stream-episode';
import { buildStreamGroups } from './stream-grouping';
import type { StreamEventRow } from './stream-meta';
import { useInfiniteScrollSentinel } from './use-infinite-scroll-sentinel';

/** Props for {@link StreamView}. */
export interface StreamViewProps {
  readonly scope: 'me' | 'org';
  readonly contextName?: string;
  readonly catalog: FieldCatalog<StreamEventRow>;
  readonly state: ViewState;
  readonly onFiltersChange: (filters: readonly ViewFilterTerm[]) => void;
  readonly onGroupByChange: (groupBy: ViewGroupTerm | null) => void;
  readonly onSortChange: (sort: readonly ViewSortTerm[]) => void;
  readonly events: readonly StreamEventRow[];
  readonly newEventCount: number;
  readonly onShowNewEvents: () => void;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => void;
  readonly resolveOrgName?: (orgId: string) => string;
  readonly onSelect?: (row: StreamEventRow) => void;
  readonly saveSlot?: ReactNode;
  readonly now?: Date;
}

/** A small loading skeleton shaped like subject-led episodes. */
function TimelineSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="border-outline-variant/70 grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-b py-4"
        >
          <div className="bg-surface-container size-10 animate-pulse rounded-full" />
          <div className="space-y-2.5">
            <div className="bg-surface-container h-3.5 w-2/5 animate-pulse rounded" />
            <div className="bg-surface-container h-3 w-3/4 animate-pulse rounded" />
            <div className="bg-surface-container h-3 w-1/2 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The unified Stream surface. */
export function StreamView(props: StreamViewProps): JSX.Element {
  const now = props.now ?? new Date();
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const sentinelRef = useInfiniteScrollSentinel(
    props.fetchNextPage,
    props.hasNextPage && !props.isFetchingNextPage,
  );
  const groups = buildStreamGroups(props.events, now);
  const hasFilters = props.state.filters.length > 0;

  useEffect(() => {
    const node = topSentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setAtTop(Boolean(entry?.isIntersecting));
      },
      { threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (atTop && props.newEventCount > 0) {
      props.onShowNewEvents();
      setAnnouncement(
        `${String(props.newEventCount)} new ${props.newEventCount === 1 ? 'event' : 'events'} added`,
      );
    }
  }, [atTop, props.newEventCount, props.onShowNewEvents]);

  function showNewEvents(): void {
    const count = props.newEventCount;
    props.onShowNewEvents();
    topSentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    setAnnouncement(`${String(count)} new ${count === 1 ? 'event' : 'events'} shown`);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <div ref={topSentinelRef} aria-hidden="true" />
      <header>
        <h1 ref={headingRef} tabIndex={-1} className="text-title-large rounded-sm outline-none">
          Stream
        </h1>
        <p className="text-on-surface-variant text-body-small">
          {props.scope === 'me'
            ? 'Everything that happened across your workspaces.'
            : `Everything that happened in ${props.contextName ?? 'this workspace'}.`}
        </p>
      </header>

      <FilterToolbar
        catalog={props.catalog}
        state={props.state}
        onFiltersChange={props.onFiltersChange}
        onGroupByChange={props.onGroupByChange}
        onSortChange={props.onSortChange}
        filterTriggerLabel="Filters"
        alwaysShowFilterLabel
        {...(props.saveSlot ? { saveSlot: props.saveSlot } : {})}
      />

      <div aria-live="polite" className="flex min-h-0 justify-center">
        {props.newEventCount > 0 && !atTop ? (
          <Button type="button" variant="secondary" size="sm" onClick={showNewEvents}>
            {String(props.newEventCount)} new {props.newEventCount === 1 ? 'event' : 'events'}
          </Button>
        ) : null}
        <span className="sr-only">{announcement}</span>
      </div>

      {props.error ? (
        <div
          role="alert"
          className="border-outline-variant text-on-surface-variant text-body-small flex items-center justify-between rounded-lg border p-4"
        >
          <span>{props.error}</span>
          <button type="button" className="text-primary min-h-10 px-2" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      ) : props.loading && props.events.length === 0 ? (
        <TimelineSkeleton />
      ) : props.events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={hasFilters ? 'No events match these filters' : 'Nothing yet'}
          body={
            hasFilters
              ? 'Clear the filters to return to the full timeline.'
              : 'Activity will appear here as work happens across your connected tools.'
          }
          {...(hasFilters
            ? {
                cta: {
                  label: 'Clear filters',
                  onClick: () => {
                    props.onFiltersChange([]);
                  },
                },
              }
            : {})}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section
              key={group.label}
              aria-labelledby={`stream-${group.label.replaceAll(' ', '-')}`}
            >
              <h2
                id={`stream-${group.label.replaceAll(' ', '-')}`}
                className="text-on-surface-variant text-label-small mb-1"
              >
                {group.label}
              </h2>
              <div>
                {group.episodes.map((episode) => (
                  <StreamEpisodeView
                    key={episode.id}
                    episode={episode}
                    scope={props.scope}
                    {...(props.resolveOrgName
                      ? {
                          orgName: props.resolveOrgName(episode.allEvents[0]?.organizationId ?? ''),
                        }
                      : {})}
                    {...(props.onSelect ? { onSelect: props.onSelect } : {})}
                  />
                ))}
              </div>
            </section>
          ))}
          <div ref={sentinelRef} aria-hidden="true" />
          {props.isFetchingNextPage ? (
            <p className="text-on-surface-variant text-body-small py-2 text-center">
              Loading more…
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
