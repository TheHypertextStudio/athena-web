'use client';

/**
 * `stream` — the controlled, context-wide chronological timeline surface.
 *
 * @remarks
 * ## Containment rather than separation
 *
 * Each recency section is a tonal card and each episode inside it is a row of that card, so the
 * feed's structure is read from surface steps and a continuous timeline rail instead of from
 * hairline rules. That is the design system's own instruction (§8: a tonal step separates two
 * regions without drawing a line, and grouping is not on the list of things a border may do) —
 * the previous ledger drew a `border-b` per episode, a `divide-y` per event, and a `border-l` on
 * the disclosed list, which is three separators doing one job.
 *
 * ## The page frame is the shared one
 *
 * This surface used to hand-roll its own measure, padding rhythm, and title token, which is how
 * Stream ended up with a smaller `<h1>` than every other index page. It composes
 * {@link ListPageLayout} now, so the frame is whatever the rest of the product's frame is.
 */
import { EmptyState } from '@docket/ui/components';
import { Activity } from '@docket/ui/icons';
import { Badge, Button, Surface } from '@docket/ui/primitives';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import {
  type FieldCatalog,
  type ViewFilterTerm,
  type ViewGroupTerm,
  type ViewSortTerm,
  type ViewState,
} from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';

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
  readonly saveSlot?: ReactNode;
  readonly now?: Date;
}

/**
 * A loading skeleton shaped like the resolved layout.
 *
 * @remarks
 * Same tonal card, same 40px subject disc, same spine gutter, same row rhythm — a skeleton that
 * settles into a differently-shaped result is a layout shift wearing a placeholder's clothes.
 */
function TimelineSkeleton(): JSX.Element {
  return (
    <Surface tone="card" shape="large" className="px-4 py-2" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 py-4">
          <div className="bg-surface-container-high size-10 animate-pulse rounded-full" />
          <div className="space-y-2.5 pt-1">
            <div className="bg-surface-container-high h-3.5 w-2/5 animate-pulse rounded" />
            <div className="bg-surface-container-high h-3 w-3/4 animate-pulse rounded" />
            <div className="bg-surface-container-high h-3 w-1/2 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </Surface>
  );
}

/** The unified Stream surface. */
export function StreamView(props: StreamViewProps): JSX.Element {
  const now = props.now ?? new Date();
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
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
    // Move the caret to the top of the feed as well as the scroll position: a keyboard user who
    // asked for the new events should continue reading from them, not from wherever they were.
    requestAnimationFrame(() => {
      feedRef.current?.focus({ preventScroll: true });
    });
    setAnnouncement(`${String(count)} new ${count === 1 ? 'event' : 'events'} shown`);
  }

  return (
    <ListPageLayout
      title="Stream"
      subtitle={
        props.scope === 'me'
          ? 'Everything that happened across your workspaces.'
          : `Everything that happened in ${props.contextName ?? 'this workspace'}.`
      }
      toolbar={
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
      }
    >
      {/* One wrapper, not a fragment: a fragment's children are still separate flex children, and
          the page container's `gap` spaces every sibling whether or not it rendered anything. The
          scroll sentinel and the live region both take zero height, so as siblings they were
          collecting ~64px of gap between the toolbar and the first day. */}
      <div className="flex min-w-0 flex-col">
        <div ref={topSentinelRef} aria-hidden="true" />
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>

        {props.newEventCount > 0 && !atTop ? (
          <div className="flex justify-center pb-4">
            <Button type="button" variant="secondary" size="sm" onClick={showNewEvents}>
              {String(props.newEventCount)} new {props.newEventCount === 1 ? 'event' : 'events'}
            </Button>
          </div>
        ) : null}

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
          <div
            ref={feedRef}
            tabIndex={-1}
            aria-label="Activity timeline"
            className="flex flex-col gap-4 rounded-sm outline-none"
          >
            {groups.map((group) => {
              const headingId = `stream-${group.label.replaceAll(' ', '-')}`;
              return (
                <Surface
                  key={group.label}
                  as="section"
                  tone="card"
                  shape="large"
                  aria-labelledby={headingId}
                  className="px-4 pb-2"
                >
                  {/* No `overflow-hidden` on this card: it would become the scroll container and
                    the sticky header below would stop sticking. */}
                  <div className="bg-surface-container-low sticky top-0 z-10 -mx-4 flex items-center gap-2 px-4 py-2">
                    <h2 id={headingId} className="text-on-surface text-title-small">
                      {group.label}
                    </h2>
                    <Badge variant="secondary">{String(group.episodes.length)}</Badge>
                  </div>
                  {group.episodes.map((episode) => (
                    <StreamEpisodeView
                      key={episode.key}
                      episode={episode}
                      scope={props.scope}
                      {...(props.resolveOrgName
                        ? {
                            orgName: props.resolveOrgName(
                              episode.allEvents[0]?.organizationId ?? '',
                            ),
                          }
                        : {})}
                    />
                  ))}
                </Surface>
              );
            })}
            <div ref={sentinelRef} aria-hidden="true" />
            {props.isFetchingNextPage ? (
              <p className="text-on-surface-variant text-body-small py-2 text-center">
                Loading more…
              </p>
            ) : null}
          </div>
        )}
      </div>
    </ListPageLayout>
  );
}
