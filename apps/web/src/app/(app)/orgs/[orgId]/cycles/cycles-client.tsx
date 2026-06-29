'use client';

/**
 * The Cycles list (product §8.5).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/cycles` (mounted by the server entry in
 * `page.tsx`, which SSR-prefetches the roster + its stats into the cache). It lists the org's
 * time-boxed cadences, each summarized as a {@link CycleRow} that links to its detail.
 *
 * A cycle's pace numbers (committed/completed, capacity, carryover) live on the single-cycle
 * read, not the list, so the page fetches each cycle's `…/cycles/:id` stats in parallel after
 * the list lands and threads them into the rows as they arrive — the rows show a slim
 * skeleton until then, so nothing jumps. When the page is SSR-hydrated those stats are already
 * warm, so the rows paint complete on first load. The cycle noun routes through
 * {@link useVocabulary} so an org's skin (e.g. "Sprint") shows through.
 *
 * The bespoke Current/Upcoming/Completed segments are gone: the roster adopts the unified
 * {@link FilterToolbar} over the cycle {@link buildCycleCatalog | catalog}, so it can be filtered
 * by status / team, grouped, and sorted — all applied **client-side** over the already-loaded
 * {@link useApiListQuery} results (the stats fan-out is preserved; no manual refresh). The view state
 * is held in the URL by {@link useViewState}, defaulting to a group-by-status grouping so the
 * familiar segmented look is preserved, but now user-changeable.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { EmptyState, EntityList, StatusIcon } from '@docket/ui/components';
import type { WorkflowStateType } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { RefreshCw } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { buildCycleCatalog } from '@/components/cycles/cycle-catalog';
import { CycleRow } from '@/components/cycles/cycle-row';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import { type FieldOption, type ViewState } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { useViewState } from '@/components/views/use-view-state';
import { isEmptyViewState } from '@/components/views/view-state-url';
import { cycleDetailDef } from '@/lib/fetch-cycle-detail';
import { fetchCyclesWithStats } from '@/lib/fetch-cycles-with-stats';
import { apiQueryOptions, queryKeys, useApiListQuery, usePrefetchApi } from '@/lib/query';

/** The default view applied when the URL carries none: group by status (the legacy segments). */
const DEFAULT_VIEW: ViewState = {
  filters: [],
  groupBy: { field: 'status' },
  sort: [],
};

/** Shared frozen empties for the roster fallbacks (stable identity, no per-render allocation). */
const EMPTY_CYCLES: readonly CycleOut[] = [];
const EMPTY_STATS: Readonly<Record<string, CycleStats>> = {};

/**
 * The org Cycles list (Client Component).
 *
 * @returns the rendered roster.
 */
export default function CyclesClient(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const prefetch = usePrefetchApi();

  const { teams } = useActiveOrg();

  const cycleNoun = useVocabulary('cycle');
  const cycleNounPlural = useVocabulary('cycle', { plural: true });
  const teamLabel = useVocabulary('team');

  const { state, setFilters, setGroupBy, setSort } = useViewState();

  // The list endpoint auto-rolls every team's window server-side before listing, so the roster no
  // longer depends on the client's teams — one org-scoped key, fetched immediately (`teams` is
  // still read below, only for the filter/group catalog).
  const cyclesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.cycles(orgId),
      fetchCyclesWithStats(orgId),
      'Could not load your cycles.',
    ),
  );

  // react-query keeps `data` referentially stable, so these read straight off it; the frozen
  // empties keep the fallbacks stable too — no useMemo needed.
  const cycles: readonly CycleOut[] = cyclesQ.data?.cycles ?? EMPTY_CYCLES;
  const statsById: Readonly<Record<string, CycleStats>> = cyclesQ.data?.statsById ?? EMPTY_STATS;
  const loading = cyclesQ.isPending;
  const loadError = cyclesQ.isError ? cyclesQ.error.message : null;

  /** Team display name by id (for the team filter labels + group headers). */
  const teamNameById = useMemo(
    () => new Map<string, string>(teams.map((t) => [t.id, t.name])),
    [teams],
  );

  /** The cycle field catalog driving the toolbar + the apply engine. */
  const catalog = useMemo(
    () =>
      buildCycleCatalog({
        teamLabel,
        teamOptions: (): readonly FieldOption[] =>
          teams.map((t) => ({ value: t.id, label: t.name })),
        resolveTeam: (id) => teamNameById.get(id) ?? id,
      }),
    [teamLabel, teamNameById, teams],
  );

  /** Default to the legacy group-by-status segments until the user configures the view. */
  const effectiveState = useMemo(() => (isEmptyViewState(state) ? DEFAULT_VIEW : state), [state]);

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(
    () => applyView(cycles, effectiveState, catalog),
    [cycles, effectiveState, catalog],
  );

  const total = cycles.length;

  /** Render one cycle row (shared by the flat + grouped renders). */
  const renderRow = useCallback(
    (cycle: CycleOut): JSX.Element => (
      <CycleRow
        key={cycle.id}
        cycle={cycle}
        stats={statsById[cycle.id] ?? null}
        cycleNoun={cycleNoun}
        href={`/orgs/${orgId}/cycles/${cycle.id}`}
        onPrefetch={() => {
          prefetch(cycleDetailDef(orgId, cycle.id));
        }}
      />
    ),
    [cycleNoun, orgId, statsById, prefetch],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-h1">{cycleNounPlural}</h1>
          <p className="text-on-surface-variant text-xs">
            {`${cycleNounPlural} roll automatically on your cadence — what's live now, what's coming up, and what's wrapped.`}
          </p>
        </div>
      </header>

      {!loading && !loadError && total > 0 ? (
        <FilterToolbar
          catalog={catalog}
          state={effectiveState}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      ) : null}

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
        >
          {loadError}
        </p>
      ) : total === 0 ? (
        // Only reachable with no team to roll for — cycles auto-materialize per team cadence.
        <EmptyState
          icon={RefreshCw}
          title={`${cycleNounPlural} roll on their own`}
          body={`As soon as your space has a team, Docket keeps a rolling window of ${cycleNounPlural.toLowerCase()} — past, current, and upcoming — on its cadence. Nothing to set up.`}
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={`No matching ${cycleNounPlural.toLowerCase()}`}
          body={`No ${cycleNoun.toLowerCase()} matches the active filters. Adjust or clear them to see more.`}
        />
      ) : applied.groups ? (
        <div className="flex flex-col gap-6">
          {applied.groups.map((group) => (
            <section
              key={group.id}
              aria-label={`${group.label} ${cycleNounPlural.toLowerCase()}`}
              className="flex flex-col gap-3"
            >
              <h2 className="text-on-surface-variant flex items-center gap-2 text-xs font-medium">
                {effectiveState.groupBy?.field === 'status' &&
                group.hint &&
                group.id !== EMPTY_GROUP_ID ? (
                  <StatusIcon type={group.hint as WorkflowStateType} label={group.label} />
                ) : null}
                <span>{group.label}</span>
                <span className="tabular-nums">{group.rows.length}</span>
              </h2>
              <EntityList aria-label={`${group.label} ${cycleNounPlural.toLowerCase()}`}>
                {group.rows.map(renderRow)}
              </EntityList>
            </section>
          ))}
        </div>
      ) : (
        <EntityList aria-label={cycleNounPlural}>{applied.rows.map(renderRow)}</EntityList>
      )}
    </div>
  );
}

/** Loading placeholder for the list: two labeled segments of cycle rows. */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <div className="border-outline-variant divide-outline-variant flex flex-col divide-y overflow-hidden rounded-xl border">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3 px-3 py-2.5">
                <Skeleton className="size-4 rounded-full" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="ml-auto h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
