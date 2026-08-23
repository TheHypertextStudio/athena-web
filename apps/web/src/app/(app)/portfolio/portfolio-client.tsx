'use client';

import { EmptyState } from '@docket/ui/components';
import { ChevronDown, LayoutGrid, TuneRounded } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Skeleton,
} from '@docket/ui/primitives';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import {
  buildHubTimelineCatalog,
  buildHubTimelineView,
} from '@/components/portfolio/hub-timeline-catalog';
import { OrgFilterChips } from '@/components/portfolio/org-filter-chips';
import TimelineCanvas from '@/components/timeline/timeline-canvas';
import { useTimelineViewport } from '@/components/timeline/use-timeline-viewport';
import TimelineDisplaySections from '@/components/timeline/timeline-display-sections';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/**
 * The Hub "Portfolio" surface — one cross-org roadmap timeline.
 *
 * @remarks
 * A Client Component and the caller's flagship cross-org planning view. It reads the aggregated
 * roadmap via `api.v1.hub.portfolio.$get` (org swimlanes → Program lanes → Project bars, each item
 * carrying its originating org) and renders it through the **shared timeline engine** rather than
 * a bespoke roadmap of its own.
 *
 * That sharing is the point. The portfolio and the org Projects lens previously maintained two
 * separate timeline implementations, and the newer one was markedly worse — no real axis, no
 * scale model, empty bars. Both now render {@link TimelineCanvas} over their own
 * `TimelineCatalog`, so the calendar axis, zoom, grouping, markers, and accessibility are written
 * once and improve for both at the same time.
 *
 * - **Org bands** are the grouping — each tenant's slice, contiguous and never merged with another's.
 * - **Programs** surface as row context beside each Project's name.
 * - **Org focus chips** narrow the roadmap to one tenant.
 * - The surface is **read-only**: cross-org rescheduling belongs in the owning org's Projects lens,
 *   so `canSchedule` is false and the canvas renders without drag affordances.
 *
 * The screen owns its loading skeleton, a `role="alert"` error with retry, and a calm empty state,
 * mirroring the Today cockpit so the Hub reads as one product. It stays live without a manual
 * refresh: the dynamic-data layer auto-refetches on window focus and after any mutation.
 */
/** No-op for the canvas's write callbacks: the portfolio is a read-only, cross-org roadmap. */
function noop(): void {
  /* The portfolio never schedules; the owning org's Projects lens does. */
}

/**
 * The Portfolio surface: every org's projects on one cross-org roadmap.
 *
 * @remarks
 * Read-only by design — scheduling belongs to the owning org's Projects lens, so the canvas's
 * write callbacks are wired to {@link noop}. Owns its own loading skeleton, `role="alert"` error
 * state with retry, and empty state, and stays live via the query layer's focus/mutation refetch.
 *
 * @returns the portfolio screen.
 */
export default function PortfolioClient(): JSX.Element {
  const router = useRouter();
  const { orgName } = useActiveOrg();
  const { display, setDisplay } = useViewState();

  const portfolioQ = useApiQuery(
    apiQueryOptions(
      queryKeys.portfolio(),
      () => api.v1.hub.portfolio.$get({ query: {} }),
      'Could not load your portfolio.',
    ),
  );
  const data = portfolioQ.data ?? null;
  const loading = portfolioQ.isPending;
  const error = portfolioQ.isError
    ? userErrorMessage(portfolioQ.error, 'Could not load the portfolio.')
    : null;

  /** The focused org id (the roadmap narrows to that band), or null for every org. */
  const [focusedOrgId, setFocusedOrgId] = useState<string | null>(null);

  const swimlanes = useMemo(() => data?.swimlanes ?? [], [data]);
  const catalog = useMemo(() => buildHubTimelineCatalog(), []);
  const applied = useMemo(
    () => buildHubTimelineView(swimlanes, focusedOrgId),
    [focusedOrgId, swimlanes],
  );
  const spans = useMemo(
    () =>
      applied.rows
        .map((row) => catalog.span(row))
        .filter((span): span is NonNullable<typeof span> => span !== null),
    [applied.rows, catalog],
  );
  const viewport = useTimelineViewport(spans, display.scale);

  // The org focus chips: every org with at least one bar, in swimlane order, name-resolved.
  const orgFilterOptions = useMemo(
    () =>
      swimlanes
        .map((swimlane) => ({
          id: swimlane.organization.id,
          name: swimlane.organization.name || orgName(swimlane.organization.id),
          count:
            swimlane.unassigned.length +
            swimlane.programs.reduce((sum, lane) => sum + lane.projects.length, 0),
        }))
        .filter((option) => option.count > 0),
    [orgName, swimlanes],
  );

  const hasAnyBars = orgFilterOptions.length > 0;

  // Clear a stale focus if the focused org no longer carries any work on a reload.
  useEffect(() => {
    if (focusedOrgId && !orgFilterOptions.some((option) => option.id === focusedOrgId)) {
      setFocusedOrgId(null);
    }
  }, [focusedOrgId, orgFilterOptions]);

  const hasSwimlanes = swimlanes.length > 0;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-4 px-3 py-4 @2xl:gap-5 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-on-surface text-title-large">Portfolio</h1>
          <p className="text-on-surface-variant hidden text-xs @2xl:block">
            Every venture on one timeline.
          </p>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="border-error/40 bg-error/5 text-error text-body-medium flex items-center justify-between gap-4 rounded-lg border p-4"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void portfolioQ.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}

      {loading ? (
        <TimelineSkeleton />
      ) : !hasSwimlanes ? (
        <EmptyState
          icon={LayoutGrid}
          title="No roadmap yet"
          body="Once you have projects in flight, they appear here on one shared timeline."
        />
      ) : !hasAnyBars ? (
        <EmptyState
          icon={LayoutGrid}
          title="Nothing in flight"
          body="Once you have projects in flight, they appear here on one shared timeline."
        />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="min-h-10 gap-1.5 @2xl:min-h-8">
                  <TuneRounded className="size-4" aria-hidden="true" />
                  <span className="hidden @2xl:inline">Display</span>
                  <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width="md">
                <TimelineDisplaySections
                  display={display}
                  onDisplayChange={setDisplay}
                  onToday={viewport.resetToToday}
                  onZoomIn={viewport.zoomIn}
                  onZoomOut={viewport.zoomOut}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {orgFilterOptions.length > 1 ? (
            <OrgFilterChips
              options={orgFilterOptions}
              focusedOrgId={focusedOrgId}
              onFocus={setFocusedOrgId}
            />
          ) : null}
          <TimelineCanvas
            applied={applied}
            catalog={catalog}
            display={display}
            viewport={viewport}
            noun="Project"
            pluralNoun="Projects"
            canSchedule={false}
            onReschedule={noop}
            onApplyCascade={noop}
            applyingCascade={false}
            onActivate={(projectId) => {
              const row = applied.rows.find((entry) => entry.bar.id === projectId);
              if (row) router.push(`/orgs/${row.bar.organizationId}/projects/${row.bar.id}`);
            }}
            onPrefetch={noop}
          />
        </div>
      )}
    </div>
  );
}

/** Loading placeholder for the roadmap: an axis header strip over a few swimlane bands. */
function TimelineSkeleton(): JSX.Element {
  // placeholder: the roadmap's contents — which time buckets the axis spans (derived from the
  // work's own dates, not the calendar), which organizations and projects become swimlanes, and
  // where each bar starts and ends. The page heading and range controls above are static copy.
  return (
    <div className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="border-outline-variant flex items-center gap-6 border-b px-4 py-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
      </div>
      {[0, 1, 2].map((band) => (
        <div key={band} className="border-outline-variant grid grid-cols-[12rem_1fr] border-b">
          <div className="border-outline-variant flex items-center border-r px-4 py-4">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-8 rounded-md" style={{ width: '60%', marginLeft: '8%' }} />
            <Skeleton className="h-8 rounded-md" style={{ width: '38%', marginLeft: '30%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
