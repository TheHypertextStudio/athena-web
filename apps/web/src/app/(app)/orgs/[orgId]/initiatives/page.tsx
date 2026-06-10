'use client';

/**
 * The Initiatives list (mvp-plan §8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/initiatives`. An Initiative is a cross-cutting
 * *theme* that holds no work of its own — it associates many-to-many with Projects + Programs —
 * so this list is a portfolio of themes, not a work queue. The roster renders through the shared
 * {@link EntityTable}: a leading derived-status glyph, a flexing **Title** column, and the theme's
 * key properties — status, rolled-up health, and the membership mix (how many Programs / Projects
 * it spans) — in **aligned** columns under a light header. This is the same column-aligned surface
 * the Projects roster renders through (the user's mandate: "structured the same … just like
 * Linear"); an Initiative simply differs in its trailing scope columns, since it carries no lead or
 * target date of its own.
 *
 * The list endpoint returns only the stored Initiative rows; the per-theme roll-up
 * (`childMix` / `derivedStatus` / `rolledUpHealth`) lives on the detail read, so the page enriches
 * each row by fetching its detail in parallel (the same enrich-per-item idiom the project-detail
 * screen uses for task milestones). That composite read is cached + kept live through the
 * dynamic-data layer (auto-refetch on focus + after a create), so there is no manual refresh.
 *
 * The roster adopts the unified {@link FilterToolbar} over the initiative
 * {@link buildInitiativeCatalog | catalog}, and the table's columns are derived from that same
 * catalog ({@link initiativeColumns}) so the toolbar's group/sort fields and the table headers read
 * from one source of truth. It can be filtered by status / health, grouped, and sorted — all
 * applied **client-side** over the already-loaded {@link useApiQuery} results (the enrich-per-item
 * data flow is preserved; no manual refresh). The view state is held in the URL by
 * {@link useViewState}, defaulting to a group-by-status grouping so the familiar sectioned look is
 * preserved, but now user-changeable; grouping renders full-width {@link GroupHeader} boundary rows
 * that span every column.
 *
 * A header "New {initiative}" affordance creates a theme from a name; the entity noun routes
 * through {@link useVocabulary} so vocabulary skins apply. Data is fetched at runtime, so the
 * production build needs no running server.
 */
import type { InitiativeDetail, InitiativeOut } from '@docket/types';
import { EmptyState, EntityTable, StatusIcon } from '@docket/ui/components';
import type { WorkflowStateType } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Plus, Target } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  buildInitiativeCatalog,
  initiativeColumns,
  type InitiativeCatalogRow,
} from '@/components/initiatives/initiative-catalog';
import { CreateInitiativeDialog } from '@/components/initiatives/create-initiative';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
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
  const programNounPlural = useVocabulary('program', { plural: true }).toLowerCase();
  const programsHeader = useVocabulary('program', { plural: true });
  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const projectsHeader = useVocabulary('project', { plural: true });

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

  /** The initiative field catalog driving the toolbar + the apply engine + the table columns. */
  const catalog = useMemo(() => buildInitiativeCatalog(), []);

  /** The aligned table columns, derived from the same catalog the toolbar drives. */
  const columns = useMemo(
    () =>
      initiativeColumns(catalog, {
        programsHeader,
        programNoun,
        programNounPlural,
        projectsHeader,
        projectNoun,
        projectNounPlural,
      }),
    [
      catalog,
      programsHeader,
      programNoun,
      programNounPlural,
      projectsHeader,
      projectNoun,
      projectNounPlural,
    ],
  );

  /** Default to the legacy group-by-status sections until the user configures the view. */
  const effectiveState = useMemo(() => (isEmptyViewState(state) ? DEFAULT_VIEW : state), [state]);

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(
    () => applyView(initiatives, effectiveState, catalog),
    [initiatives, effectiveState, catalog],
  );

  /** Map an `applyView` bucket onto an {@link EntityTable} group (status buckets carry a glyph). */
  const groups = useMemo(() => {
    if (!applied.groups) return undefined;
    const isStatusGroup = effectiveState.groupBy?.field === 'derivedStatus';
    return applied.groups.map((group) => ({
      id: group.id,
      label: group.label,
      decoration:
        isStatusGroup && group.hint && group.id !== EMPTY_GROUP_ID ? (
          <StatusIcon type={group.hint as WorkflowStateType} label={group.label} />
        ) : undefined,
      rows: group.rows,
    }));
  }, [applied.groups, effectiveState.groupBy]);

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
        <ListSkeleton />
      ) : error ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
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
      ) : (
        <EntityTable
          aria-label={initiativeNounPlural}
          columns={columns}
          groups={groups}
          rows={applied.rows}
          getRowKey={(initiative) => initiative.id}
          rowHref={(initiative) => `/orgs/${orgId}/initiatives/${initiative.id}`}
          renderRowLink={(lp) => (
            <Link
              href={lp.href}
              className={lp.className}
              onClick={lp.onClick}
              tabIndex={lp.tabIndex}
              aria-current={lp['aria-current']}
            >
              {lp.children}
            </Link>
          )}
        />
      )}
    </div>
  );
}

/** Loading placeholder: a bordered list of slim row skeletons matching the table density. */
function ListSkeleton(): JSX.Element {
  return (
    <div
      className="border-outline-variant divide-outline-variant flex flex-col divide-y overflow-hidden rounded-xl border"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex min-h-9 items-center gap-2 px-3 py-1.5">
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
