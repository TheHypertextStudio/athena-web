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
 *
 * The page composes the shared {@link ListPageLayout} — the *same* import Projects, Initiatives and
 * Programs use — rather than the hand-rolled `max-w-6xl` wrapper and inline `<h1>` it carried
 * before, so its measure, gutters, header rhythm and title token are the app's and not its own.
 * It passes **no subtitle**: the orientation line under the title was removed outright, and because
 * `ListPageLayout` only renders a `PageSubtitle` when one is passed, it leaves no residual gap.
 *
 * The roster is headed by the {@link ActiveCycleOverview}, which answers "what is running right
 * now and how is it going" without a click. The active cycle *also* stays in the roster below —
 * subordination is by weight, not by hiding, so a filter never lies about what it matched.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { EmptyState, StatusIcon } from '@docket/ui/components';
import type { WorkflowStateType } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { RefreshCw } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useTypedRoute } from '@/lib/app-location';
import { type JSX, useCallback, useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { ActiveCycleOverview, findActiveCycle } from '@/components/cycles/active-cycle-overview';
import { buildCycleCatalog } from '@/components/cycles/cycle-catalog';
import { type CycleRowProps, CycleRows } from '@/components/cycles/cycle-row';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import {
  resolveRelationLabel,
  type FieldOption,
  type ViewState,
} from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { ListPageLayout } from '@/components/views/page-layout';
import { useViewState } from '@/components/views/use-view-state';
import { isEmptyViewState } from '@/components/views/view-state-url';
import { cycleDetailDef } from '@/lib/fetch-cycle-detail';
import { fetchCyclesWithStats } from '@/lib/fetch-cycles-with-stats';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  usePrefetchApi,
} from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { useOrgCapability } from '@/lib/use-org-capability';

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
  const params = useTypedRoute('/orgs/[orgId]/cycles').params;
  const orgId = params.orgId;
  const prefetch = usePrefetchApi();
  const router = useRouter();

  const { teams, teamsLoading } = useActiveOrg();

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
      fetchCyclesWithStats(orgId, api),
      'Could not load your cycles.',
    ),
  );

  // Members + roles resolve whether the caller can rename a cycle inline. A Cycle PATCH requires
  // `contribute` server-side, so the affordance is gated on that same capability (the server still
  // enforces it regardless).
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(orgId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      'Could not load members.',
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(orgId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      'Could not load roles.',
    ),
  );
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
  const roles = useMemo(() => rolesQ.data?.items ?? [], [rolesQ.data]);
  const canRename = useOrgCapability(members, roles, 'contribute');

  const renameCycle = useApiMutation<CycleOut, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      unwrap(
        () => api.v1.orgs[':orgId'].cycles[':id'].$patch({ param: { orgId, id }, json: { name } }),
        `Could not rename this ${cycleNoun.toLowerCase()}.`,
      ),
    invalidateKeys: [queryKeys.cycles(orgId)],
  });

  // react-query keeps `data` referentially stable, so these read straight off it; the frozen
  // empties keep the fallbacks stable too — no useMemo needed.
  const cycles: readonly CycleOut[] = cyclesQ.data?.cycles ?? EMPTY_CYCLES;
  const statsById: Readonly<Record<string, CycleStats>> = cyclesQ.data?.statsById ?? EMPTY_STATS;
  const loading = cyclesQ.isPending;
  const loadError = cyclesQ.isError
    ? userErrorMessage(cyclesQ.error, 'Could not load cycles.')
    : null;

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
        resolveTeam: (id) => resolveRelationLabel(id, teamsLoading, (i) => teamNameById.get(i)),
      }),
    [teamLabel, teamNameById, teams, teamsLoading],
  );

  /** Default to the legacy group-by-status segments until the user configures the view. */
  const effectiveState = useMemo(() => (isEmptyViewState(state) ? DEFAULT_VIEW : state), [state]);

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(
    () => applyView(cycles, effectiveState, catalog),
    [cycles, effectiveState, catalog],
  );

  const total = cycles.length;

  /** Build one cycle row's props (shared by the flat + grouped renders). */
  const toRowProps = useCallback(
    (cycle: CycleOut): CycleRowProps => ({
      cycle,
      stats: statsById[cycle.id] ?? null,
      teamName: resolveRelationLabel(cycle.teamId, teamsLoading, (i) => teamNameById.get(i)),
      cycleNoun,
      href: `/orgs/${orgId}/cycles/${cycle.id}`,
      onPrefetch: () => {
        prefetch(cycleDetailDef(orgId, cycle.id));
      },
      canRename,
      onRename: (id, name) => {
        renameCycle.mutate({ id, name });
      },
      onOpen: () => {
        router.push(`/orgs/${orgId}/cycles/${cycle.id}`);
      },
    }),
    [
      cycleNoun,
      orgId,
      statsById,
      teamNameById,
      teamsLoading,
      prefetch,
      canRename,
      renameCycle,
      router,
    ],
  );

  /** The cycle running right now — the overview's subject, when there is one. */
  const activeCycle = useMemo(() => findActiveCycle(cycles), [cycles]);

  return (
    <ListPageLayout
      title={cycleNounPlural}
      fill
      toolbar={
        !loading && !loadError && total > 0 ? (
          <FilterToolbar
            catalog={catalog}
            state={effectiveState}
            onFiltersChange={setFilters}
            onGroupByChange={setGroupBy}
            onSortChange={setSort}
          />
        ) : null
      }
    >
      {activeCycle && !loading && !loadError ? (
        <ActiveCycleOverview
          orgId={orgId}
          cycle={activeCycle}
          teamName={resolveRelationLabel(activeCycle.teamId, teamsLoading, (i) =>
            teamNameById.get(i),
          )}
          stats={statsById[activeCycle.id] ?? null}
          cycleNoun={cycleNoun}
        />
      ) : null}

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p role="alert" className="text-error text-body-medium p-4">
          {loadError}
        </p>
      ) : total === 0 ? (
        // Only reachable with no team to roll for — cycles auto-materialize per team cadence.
        <EmptyState icon={RefreshCw} title={`${cycleNounPlural} roll on their own`} />
      ) : applied.rows.length === 0 ? (
        <EmptyState icon={RefreshCw} title={`No matching ${cycleNounPlural.toLowerCase()}`} />
      ) : applied.groups ? (
        <div className="flex flex-col gap-6">
          {applied.groups.map((group) => (
            <section
              key={group.id}
              aria-label={`${group.label} ${cycleNounPlural.toLowerCase()}`}
              className="flex flex-col gap-3"
            >
              <h2 className="text-on-surface-variant text-label-medium flex items-center gap-2">
                {effectiveState.groupBy?.field === 'status' &&
                group.hint &&
                group.id !== EMPTY_GROUP_ID ? (
                  <StatusIcon type={group.hint as WorkflowStateType} label={group.label} />
                ) : null}
                <span>{group.label}</span>
                <span className="tabular-nums">{group.rows.length}</span>
              </h2>
              <CycleRows
                rows={group.rows.map(toRowProps)}
                ariaLabel={`${group.label} ${cycleNounPlural.toLowerCase()}`}
              />
            </section>
          ))}
        </div>
      ) : (
        <CycleRows rows={applied.rows.map(toRowProps)} ariaLabel={cycleNounPlural} />
      )}
    </ListPageLayout>
  );
}

/** Loading placeholder for the list: two labeled segments of cycle rows. */
function ListSkeleton(): JSX.Element {
  // placeholder: the workspace's cycles — which cadence segments exist (past / current /
  // upcoming), how many cycles sit in each, and every row's name, dates and progress. Cycles
  // auto-roll on a configurable cadence, so even the segment labels depend on the fetched set.
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <div className="bg-surface-container-low flex flex-col gap-2 rounded-xl p-2">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-[72px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
