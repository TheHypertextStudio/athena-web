'use client';

import type { HubPortfolioOut } from '@docket/types';
import { LayoutGrid, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { buildLayout } from '@/components/portfolio/layout';
import { OrgFilterChips } from '@/components/portfolio/org-filter-chips';
import { RoadmapTimeline } from '@/components/portfolio/roadmap-timeline';
import { ScaleMenu } from '@/components/portfolio/scale-menu';
import { type Granularity, buildScale } from '@/components/portfolio/time-scale';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

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
 * The screen owns its loading skeleton, an inline refresh, a `role="alert"` error, and a calm
 * empty state, mirroring the Today cockpit so the Hub reads as one product.
 */
export default function PortfolioPage(): JSX.Element {
  const { orgName } = useActiveOrg();
  const [data, setData] = useState<HubPortfolioOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The requested time-scale granularity (`auto` defers to the span-derived pick). */
  const [granularity, setGranularity] = useState<Granularity>('auto');
  /** The focused org id (its band stays bright, others dim), or null for no focus. */
  const [focusedOrgId, setFocusedOrgId] = useState<string | null>(null);

  /** Load the cross-org portfolio. `initial` drives the skeleton vs. the inline refresh. */
  const load = useCallback(async (initial: boolean): Promise<void> => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await api.v1.hub.portfolio.$get({ query: {} });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not load your portfolio.'));
        return;
      }
      setData(await res.json());
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading your portfolio.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

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
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-muted-foreground text-sm">Every venture on one timeline.</p>
        </div>
        <div className="flex items-center gap-2">
          <ScaleMenu
            value={granularity}
            resolved={scale?.granularity ?? null}
            onChange={setGranularity}
            disabled={loading || !scale}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load(false);
            }}
            disabled={loading || refreshing}
          >
            <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-center justify-between gap-4 rounded-lg border p-4 text-sm"
        >
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load(true);
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
          title="No roadmap yet"
          body="Once you have projects in flight, they appear here on one shared timeline."
        />
      ) : !layout.hasAnyBars || !scale ? (
        <EmptyState
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

/** Props for {@link EmptyState}. */
interface EmptyStateProps {
  /** The empty-state headline. */
  title: string;
  /** The empty-state supporting copy. */
  body: string;
}

/** A calm, centered empty state for the portfolio. */
function EmptyState({ title, body }: EmptyStateProps): JSX.Element {
  return (
    <div className="border-border/60 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
      <LayoutGrid className="text-muted-foreground/60 size-7" aria-hidden="true" />
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-md text-sm">{body}</p>
    </div>
  );
}

/** Loading placeholder for the roadmap: an axis header strip over a few swimlane bands. */
function TimelineSkeleton(): JSX.Element {
  return (
    <div className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border">
      <div className="border-border flex items-center gap-6 border-b px-4 py-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-12" />
      </div>
      {[0, 1, 2].map((band) => (
        <div key={band} className="border-border grid grid-cols-[12rem_1fr] border-b">
          <div className="border-border flex items-center border-r px-4 py-4">
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
