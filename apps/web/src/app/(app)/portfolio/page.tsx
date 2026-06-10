'use client';

import { EmptyState } from '@docket/ui/components';
import { LayoutGrid } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { buildLayout } from '@/components/portfolio/layout';
import { OrgFilterChips } from '@/components/portfolio/org-filter-chips';
import { RoadmapTimeline } from '@/components/portfolio/roadmap-timeline';
import { ScaleMenu } from '@/components/portfolio/scale-menu';
import { type Granularity, buildScale } from '@/components/portfolio/time-scale';
import { api } from '@/lib/api';
import { queryKeys, useApiQuery } from '@/lib/query';

/**
 * The Hub "Portfolio" surface — one cross-org roadmap timeline.
 *
 * @remarks
 * A Client Component and the caller's flagship cross-org planning view. It reads the
 * aggregated roadmap via `api.v1.hub.portfolio.$get` (org swimlanes → Program lanes → Project
 * bars, each item carrying its originating org) and renders it as a single, calm, horizontally
 * scrollable {@link RoadmapTimeline}:
 *
 * - **Org swimlanes** are the default rows — each tenant's slice of the roadmap, never merged.
 * - **Programs** are ongoing lane containers (no bar of their own); **Projects** draw as bars
 *   positioned across the weeks/months they span, tinted by health, with milestone diamonds.
 * - An **adaptive time scale** auto-picks its granularity from the visible span, with a styled
 *   manual override ({@link ScaleMenu}).
 * - **Org focus chips** ({@link OrgFilterChips}) highlight one tenant's band and dim the rest
 *   without hiding any work.
 *
 * The screen owns its loading skeleton, a `role="alert"` error with retry, and a calm empty
 * state, mirroring the Today cockpit so the Hub reads as one product. It stays live without a
 * manual refresh: the dynamic-data layer auto-refetches on window focus and after any mutation.
 */
export default function PortfolioPage(): JSX.Element {
  const { orgName } = useActiveOrg();

  const portfolioQ = useApiQuery(
    queryKeys.portfolio(),
    () => api.v1.hub.portfolio.$get({ query: {} }),
    'Could not load your portfolio.',
  );
  const data = portfolioQ.data ?? null;
  const loading = portfolioQ.isPending;
  const error = portfolioQ.isError ? portfolioQ.error.message : null;

  /** The requested time-scale granularity (`auto` defers to the span-derived pick). */
  const [granularity, setGranularity] = useState<Granularity>('auto');
  /** The focused org id (its band stays bright, others dim), or null for no focus. */
  const [focusedOrgId, setFocusedOrgId] = useState<string | null>(null);

  // The render-ready layout (per-org rows + the flattened dated bars for the scale).
  const layout = useMemo(() => buildLayout(data?.swimlanes ?? []), [data]);

  // The shared, adaptive time scale derived from exactly what is on the timeline.
  const scale = useMemo(
    () => buildScale(layout.allPlaced, granularity),
    [layout.allPlaced, granularity],
  );

  // The org focus chips: every org with at least one bar, in swimlane order, name-resolved.
  const orgFilterOptions = useMemo(
    () =>
      layout.rows
        .filter((row) => row.barCount > 0)
        .map((row) => ({
          id: row.organization.id,
          name: row.organization.name || orgName(row.organization.id),
          count: row.barCount,
        })),
    [layout.rows, orgName],
  );

  // Clear a stale focus if the focused org no longer carries any work on a reload.
  useEffect(() => {
    if (focusedOrgId && !orgFilterOptions.some((option) => option.id === focusedOrgId)) {
      setFocusedOrgId(null);
    }
  }, [focusedOrgId, orgFilterOptions]);

  const hasSwimlanes = layout.rows.length > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-on-surface-variant text-xs">Every venture on one timeline.</p>
        </div>
        <div className="flex items-center gap-2">
          <ScaleMenu
            value={granularity}
            resolved={scale?.granularity ?? null}
            onChange={setGranularity}
            disabled={loading || !scale}
          />
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive text-body flex items-center justify-between gap-4 rounded-lg border p-4"
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
      ) : !layout.hasAnyBars || !scale ? (
        <EmptyState
          icon={LayoutGrid}
          title="Nothing scheduled"
          body="Set start and target dates on your projects to place them on the timeline."
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {orgFilterOptions.length > 1 ? (
            <OrgFilterChips
              options={orgFilterOptions}
              focusedOrgId={focusedOrgId}
              onFocus={setFocusedOrgId}
            />
          ) : null}
          <RoadmapTimeline rows={layout.rows} scale={scale} focusedOrgId={focusedOrgId} />
        </div>
      )}
    </div>
  );
}

/** Loading placeholder for the roadmap: an axis header strip over a few swimlane bands. */
function TimelineSkeleton(): JSX.Element {
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
