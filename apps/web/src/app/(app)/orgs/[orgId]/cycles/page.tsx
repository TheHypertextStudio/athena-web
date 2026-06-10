'use client';

/**
 * The Cycles list (product §8.5).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/cycles`. It lists the org's time-boxed cadences,
 * each summarized as a {@link CycleRow} that links to its detail.
 *
 * A cycle's pace numbers (committed/completed, capacity, carryover) live on the single-cycle
 * read, not the list, so the page fetches each cycle's `…/cycles/:id` stats in parallel after
 * the list lands and threads them into the rows as they arrive — the rows show a slim
 * skeleton until then, so nothing jumps. The cycle noun routes through {@link useVocabulary}
 * so an org's skin (e.g. "Sprint") shows through. Data is fetched at runtime, so the
 * production build needs no running server.
 *
 * The bespoke Current/Upcoming/Completed segments are gone: the roster adopts the unified
 * {@link FilterToolbar} over the cycle {@link buildCycleCatalog | catalog}, so it can be filtered
 * by status / team, grouped, and sorted — all applied **client-side** over the already-loaded
 * {@link useApiQuery} results (the stats fan-out is preserved; no manual refresh). The view state
 * is held in the URL by {@link useViewState}, defaulting to a group-by-status grouping so the
 * familiar segmented look is preserved, but now user-changeable.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { EmptyState, EntityList, StatusIcon } from '@docket/ui/components';
import type { WorkflowStateType } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Plus, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useActiveOrg } from '@/components/active-org';
import { buildCycleCatalog } from '@/components/cycles/cycle-catalog';
import { CreateCycleDialog } from '@/components/cycles/create-cycle';
import { CycleRow } from '@/components/cycles/cycle-row';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import { type FieldOption, type ViewState } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { useViewState } from '@/components/views/use-view-state';
import { isEmptyViewState } from '@/components/views/view-state-url';
import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, useApiQuery } from '@/lib/query';

/** The cycles roster joined with each cycle's pace stats (from its single-cycle read). */
interface CyclesWithStats {
  readonly cycles: readonly CycleOut[];
  readonly statsById: ReadonlyMap<string, CycleStats>;
}

/** The default view applied when the URL carries none: group by status (the legacy segments). */
const DEFAULT_VIEW: ViewState = {
  filters: [],
  groupBy: { field: 'status' },
  sort: [],
};

/**
 * Fetch the org's cycles and each cycle's pace stats, returning a {@link RpcResponse}-shaped
 * result so it can drive {@link useApiQuery} directly.
 *
 * @remarks
 * Pace numbers (committed/completed, capacity, carryover) live on the single-cycle read, not the
 * list, so each cycle is joined with its `…/cycles/:id` stats in parallel after the list lands.
 * The composite resolves `ok`/`status` from the gating list read; a failed *stats* read simply
 * omits that cycle's stats (the row shows a slim skeleton) rather than failing the whole list.
 */
function fetchCyclesWithStats(orgId: string): () => Promise<RpcResponse<CyclesWithStats>> {
  return async () => {
    const listRes = await api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } });
    if (!listRes.ok) {
      return {
        ok: false,
        status: listRes.status,
        json: () => listRes.json() as unknown as Promise<CyclesWithStats>,
      };
    }
    const { items } = await listRes.json();
    const statsById = new Map<string, CycleStats>();
    await Promise.all(
      items.map(async (cycle) => {
        const detailRes = await api.v1.orgs[':orgId'].cycles[':id'].$get({
          param: { orgId, id: cycle.id },
        });
        if (!detailRes.ok) return;
        const detail = await detailRes.json();
        statsById.set(cycle.id, detail.stats);
      }),
    );
    return {
      ok: true,
      status: listRes.status,
      json: () => Promise.resolve({ cycles: items, statsById }),
    };
  };
}

/**
 * The org Cycles list page.
 */
export default function CyclesPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const queryClient = useQueryClient();

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();

  const cycleNoun = useVocabulary('cycle');
  const cycleNounPlural = useVocabulary('cycle', { plural: true });
  const teamLabel = useVocabulary('team');

  const [createOpen, setCreateOpen] = useState(false);
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  const cyclesQ = useApiQuery(
    queryKeys.cycles(orgId),
    fetchCyclesWithStats(orgId),
    'Could not load your cycles.',
  );

  const cycles = useMemo(() => cyclesQ.data?.cycles ?? [], [cyclesQ.data]);
  const statsById = useMemo<ReadonlyMap<string, CycleStats>>(
    () => cyclesQ.data?.statsById ?? new Map(),
    [cyclesQ.data],
  );
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

  /**
   * The next team-local sequence number for a team: one past the highest existing cycle
   * number on that team, or 1 when the team has none yet. Cycles are addressed by a
   * team-scoped number ("{Cycle} 3"), and the create body requires it explicitly.
   */
  const nextNumberForTeam = useCallback(
    (teamId: string): number => {
      let max = 0;
      for (const cycle of cycles) {
        if (cycle.teamId === teamId && cycle.number > max) max = cycle.number;
      }
      return max + 1;
    },
    [cycles],
  );

  /**
   * Refetch the roster from the server (prefix-matched, so this also refreshes any open
   * cycle-detail beneath it), then open the freshly-created cycle's detail.
   */
  const handleCreated = useCallback(
    (created: CycleOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cycles(orgId) });
      router.push(`/orgs/${orgId}/cycles/${created.id}`);
    },
    [orgId, router, queryClient],
  );

  /** Render one cycle row (shared by the flat + grouped renders). */
  const renderRow = useCallback(
    (cycle: CycleOut): JSX.Element => (
      <CycleRow
        key={cycle.id}
        cycle={cycle}
        stats={statsById.get(cycle.id) ?? null}
        cycleNoun={cycleNoun}
        href={`/orgs/${orgId}/cycles/${cycle.id}`}
      />
    ),
    [cycleNoun, orgId, statsById],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-h1">{cycleNounPlural}</h1>
          <p className="text-on-surface-variant text-xs">
            Time-boxed cadences for your team — what&apos;s live now, what&apos;s coming up, and
            what&apos;s wrapped.
          </p>
        </div>
        <Button
          type="button"
          className="gap-1.5"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          New {cycleNoun}
        </Button>
      </header>

      <CreateCycleDialog
        orgId={orgId}
        cycleNoun={cycleNoun}
        teams={teams}
        defaultTeamId={defaultTeamId}
        teamsLoading={teamsLoading}
        nextNumberForTeam={nextNumberForTeam}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

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
        <EmptyState
          icon={RefreshCw}
          title={`No ${cycleNounPlural.toLowerCase()} yet`}
          body={`Start a ${cycleNoun.toLowerCase()} to time-box your team's work and track its pace and carryover at a glance.`}
          cta={{
            label: `Create your first ${cycleNoun.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
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
