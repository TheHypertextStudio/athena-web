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
 * refresh control. Rows are then partitioned into Active and Completed sections by their derived
 * status. A header "New {initiative}" affordance creates a theme from a name; the entity noun
 * routes through {@link useVocabulary} so vocabulary skins apply. Data is fetched at runtime, so
 * the production build needs no running server.
 */
import type { InitiativeDetail, InitiativeOut, InitiativeStatus } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Skeleton } from '@docket/ui/primitives';
import { Plus, Target } from '@docket/ui/icons';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, useApiQuery } from '@/lib/query';
import { CreateInitiativeDialog } from '@/components/initiatives/create-initiative';
import { InitiativeRow, type InitiativeRowData } from '@/components/initiatives/initiative-row';

/** An enriched initiative row (the stored row joined with its child roll-up). */
interface EnrichedInitiative extends InitiativeRowData {
  readonly createdAt: string;
}

/** The two derived-status sections of the list, rendered in this order. */
const SECTION_ORDER: readonly InitiativeStatus[] = ['active', 'completed'];

/** The heading for each derived-status section. */
const SECTION_LABEL: Record<InitiativeStatus, string> = {
  active: 'Active',
  completed: 'Completed',
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
): () => Promise<RpcResponse<readonly EnrichedInitiative[]>> {
  return async () => {
    const listRes = await api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } });
    if (!listRes.ok) {
      return {
        ok: false,
        status: listRes.status,
        json: () => listRes.json() as unknown as Promise<readonly EnrichedInitiative[]>,
      };
    }
    const { items } = await listRes.json();
    const enriched = await Promise.all(
      items.map(async (base): Promise<EnrichedInitiative> => {
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
function toEnriched(base: InitiativeOut, detail: InitiativeDetail | null): EnrichedInitiative {
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

  const initiativesQ = useApiQuery(
    queryKeys.initiatives(orgId),
    fetchEnrichedInitiatives(orgId),
    `Could not load ${initiativeNounPlural.toLowerCase()}.`,
  );

  const initiatives = useMemo(() => initiativesQ.data ?? [], [initiativesQ.data]);
  const loading = initiativesQ.isPending;
  const error = initiativesQ.isError ? initiativesQ.error.message : null;

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

  /** The rows partitioned by derived status, each section newest-first. */
  const sections = useMemo(() => {
    const byStatus = new Map<InitiativeStatus, EnrichedInitiative[]>();
    for (const status of SECTION_ORDER) byStatus.set(status, []);
    for (const item of initiatives) {
      (byStatus.get(item.derivedStatus) ?? byStatus.get('active'))?.push(item);
    }
    return SECTION_ORDER.map((status) => ({
      status,
      items: (byStatus.get(status) ?? []).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    })).filter((section) => section.items.length > 0);
  }, [initiatives]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
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
      ) : sections.length === 0 ? (
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
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section
              key={section.status}
              aria-label={SECTION_LABEL[section.status]}
              className="flex flex-col gap-3"
            >
              <h2 className="text-on-surface-variant flex items-center gap-2 text-xs font-medium">
                {SECTION_LABEL[section.status]}
                <span className="tabular-nums">{section.items.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {section.items.map((item) => (
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
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
