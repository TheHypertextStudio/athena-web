'use client';

/**
 * The Initiatives list (mvp-plan §8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/initiatives`. An Initiative is a cross-cutting
 * *theme* that holds no work of its own — it associates many-to-many with Projects + Programs
 * — so this list is a portfolio of themes, not a work queue. Each row leads with the theme
 * name + description, its auto-derived status, the rolled-up (worst-child) health verdict, and
 * the membership mix (how many Programs / Projects it spans).
 *
 * The list endpoint returns only the stored Initiative rows; the per-theme roll-up
 * (`childMix` / `derivedStatus` / `rolledUpHealth`) lives on the detail read, so the page
 * enriches each row by fetching its detail in parallel (the same enrich-per-item idiom the
 * project-detail screen uses for task milestones). That composite read is cached + kept live
 * through the dynamic-data layer (auto-refetch on focus + after a create), so there is no manual
 * refresh control.
 *
 * The bespoke Active/Completed partition is gone: the roster adopts the unified
 * {@link FilterToolbar} over the initiative {@link buildInitiativeCatalog | catalog}, so it can
 * be filtered by status / health, grouped, and sorted — all applied **client-side** over the
 * already-loaded {@link useApiQuery} results (the enrich-per-item data flow is preserved; no
 * manual refresh). The view state is held in the URL by {@link useViewState}, defaulting to a
 * group-by-status grouping so the familiar sectioned look is preserved, but now user-changeable.
 *
 * A header "New {initiative}" affordance creates a theme from a name; the entity noun routes
 * through {@link useVocabulary} so vocabulary skins apply. Data is fetched at runtime, so the
 * production build needs no running server.
 */
import type { InitiativeDetail, InitiativeOut } from '@docket/types';
import { EmptyState, StatusIcon } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Skeleton } from '@docket/ui/primitives';
import { Plus, Target } from '@docket/ui/icons';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  buildInitiativeCatalog,
  type InitiativeCatalogRow,
} from '@/components/initiatives/initiative-catalog';
import { CreateInitiativeDialog } from '@/components/initiatives/create-initiative';
import { InitiativeRow } from '@/components/initiatives/initiative-row';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import type { WorkflowStateType } from '@docket/ui/components';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { useViewState } from '@/components/views/use-view-state';
import { type ViewState } from '@/components/views/field-catalog';
import { isEmptyViewState } from '@/components/views/view-state-url';
import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, useApiQuery } from '@/lib/query';

/** The default view applied when the URL carries none: group by status (the legacy sections). */
const DEFAULT_VIEW: ViewState = {
  filters: [],
  groupBy: { field: 'derivedStatus' },
  sort: [],
};

/**
 * Fetch the org's initiatives and enrich each with its detail roll-up, returning a
 * {@link RpcResponse}-shaped result so it can drive {@link useApiQuery} directly.
 *
 * @remarks
 * The list endpoint returns only the stored rows, so each is joined with its detail read in
 * parallel — the same enrich-per-item idiom the project-detail screen uses. The composite resolves
 * `ok`/`status` from the gating list read; a failed *detail* read degrades to a benign default
 * (so the row still renders) rather than failing the whole list.
 */
function fetchEnrichedInitiatives(
  orgId: string,
): () => Promise<RpcResponse<readonly InitiativeCatalogRow[]>> {
  return async () => {
    const listRes = await api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } });
    if (!listRes.ok) {
      return {
        ok: false,
        status: listRes.status,
        json: () => listRes.json() as unknown as Promise<readonly InitiativeCatalogRow[]>,
      };
    }
    const { items } = await listRes.json();
    const enriched = await Promise.all(
      items.map(async (base): Promise<InitiativeCatalogRow> => {
        const detailRes = await api.v1.orgs[':orgId'].initiatives[':id'].$get({
          param: { orgId, id: base.id },
        });
        return toEnriched(base, detailRes.ok ? await detailRes.json() : null);
      }),
    );
    return { ok: true, status: listRes.status, json: () => Promise.resolve(enriched) };
  };
}

/** Reduce an Initiative + its detail roll-up into the enriched row view-model. */
function toEnriched(base: InitiativeOut, detail: InitiativeDetail | null): InitiativeCatalogRow {
  return {
    id: base.id,
    name: base.name,
    description: base.description ?? null,
    createdAt: base.createdAt,
    // The roll-up is authoritative on the detail; fall back to a benign default when the
    // detail read failed so the row still renders rather than disappearing.
    derivedStatus: detail?.derivedStatus ?? 'active',
    rolledUpHealth: detail?.rolledUpHealth ?? null,
    programCount: detail?.childMix.programs ?? 0,
    projectCount: detail?.childMix.projects ?? 0,
  };
}

/**
 * The Initiatives list page.
 *
 * @returns the rendered list.
 */
export default function InitiativesListPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const queryClient = useQueryClient();

  const initiativeNoun = useVocabulary('initiative');
  const initiativeNounLower = initiativeNoun.toLowerCase();
  const initiativeNounPlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program').toLowerCase();
  const projectNoun = useVocabulary('project').toLowerCase();

  const [createOpen, setCreateOpen] = useState(false);
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  const initiativesQ = useApiQuery(
    queryKeys.initiatives(orgId),
    fetchEnrichedInitiatives(orgId),
    `Could not load ${initiativeNounPlural.toLowerCase()}.`,
  );

  const initiatives = useMemo(() => initiativesQ.data ?? [], [initiativesQ.data]);
  const loading = initiativesQ.isPending;
  const error = initiativesQ.isError ? initiativesQ.error.message : null;

  /** The initiative field catalog driving the toolbar + the apply engine. */
  const catalog = useMemo(() => buildInitiativeCatalog(), []);

  /** Default to the legacy group-by-status sections until the user configures the view. */
  const effectiveState = useMemo(() => (isEmptyViewState(state) ? DEFAULT_VIEW : state), [state]);

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(
    () => applyView(initiatives, effectiveState, catalog),
    [initiatives, effectiveState, catalog],
  );

  /**
   * Refetch the roster from the server (prefix-matched, so this also refreshes any open
   * initiative-detail beneath it), then route to the freshly-created theme's timeline-first detail.
   */
  const handleCreated = useCallback(
    (created: InitiativeOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(orgId) });
      router.push(`/orgs/${orgId}/initiatives/${created.id}`);
    },
    [orgId, router, queryClient],
  );

  /** Render one initiative row (shared by the flat + grouped renders). */
  const renderRow = useCallback(
    (item: InitiativeCatalogRow): JSX.Element => (
      <li key={item.id}>
        <InitiativeRow
          initiative={item}
          programNoun={programNoun}
          projectNoun={projectNoun}
          onOpen={() => {
            router.push(`/orgs/${orgId}/initiatives/${item.id}`);
          }}
        />
      </li>
    ),
    [orgId, programNoun, projectNoun, router],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">
            {initiativeNounPlural}
          </h1>
          <p className="text-on-surface-variant text-xs">
            Cross-cutting themes that roll up the health of the {programNoun}s and {projectNoun}s
            beneath them — no work lives here directly.
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
          New {initiativeNoun}
        </Button>
      </header>

      <CreateInitiativeDialog
        orgId={orgId}
        initiativeNoun={initiativeNoun}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {!loading && !error && initiatives.length > 0 ? (
        <FilterToolbar
          catalog={catalog}
          state={effectiveState}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
        </div>
      ) : error ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-xl border p-4 text-sm"
        >
          {error}
        </p>
      ) : initiatives.length === 0 ? (
        <EmptyState
          icon={Target}
          title={`No ${initiativeNounPlural.toLowerCase()} yet`}
          body={`Create a theme to start grouping ${programNoun}s and ${projectNoun}s into a roadmap.`}
          cta={{
            label: `Create your first ${initiativeNounLower}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title={`No matching ${initiativeNounPlural.toLowerCase()}`}
          body={`No ${initiativeNounLower} matches the active filters. Adjust or clear them to see more.`}
        />
      ) : applied.groups ? (
        <div className="flex flex-col gap-6">
          {applied.groups.map((group) => (
            <section key={group.id} aria-label={group.label} className="flex flex-col gap-3">
              <h2 className="text-on-surface-variant flex items-center gap-2 text-xs font-medium">
                {effectiveState.groupBy?.field === 'derivedStatus' &&
                group.hint &&
                group.id !== EMPTY_GROUP_ID ? (
                  <StatusIcon type={group.hint as WorkflowStateType} label={group.label} />
                ) : null}
                <span>{group.label}</span>
                <span className="tabular-nums">{group.rows.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">{group.rows.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">{applied.rows.map(renderRow)}</ul>
      )}
    </div>
  );
}
