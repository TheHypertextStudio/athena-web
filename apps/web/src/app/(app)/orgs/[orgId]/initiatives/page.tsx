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
 * project-detail screen uses for task milestones). Rows are then partitioned into Active and
 * Completed sections by their derived status. A header "New {initiative}" affordance creates a
 * theme from a name; the entity noun routes through {@link useVocabulary} so vocabulary skins
 * apply. Data is fetched at runtime, so the production build needs no running server.
 */
import type { InitiativeDetail, InitiativeOut, InitiativeStatus } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Button, Input, Skeleton } from '@docket/ui/primitives';
import { Plus, Target } from '@docket/ui/icons';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
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

  const initiativeNoun = useVocabulary('initiative');
  const initiativeNounLower = initiativeNoun.toLowerCase();
  const initiativeNounPlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program').toLowerCase();
  const projectNoun = useVocabulary('project').toLowerCase();

  const [initiatives, setInitiatives] = useState<readonly EnrichedInitiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Load the org's initiatives, then enrich each with its detail roll-up in parallel. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } });
      if (!res.ok) {
        setError(await readProblem(res, `Could not load ${initiativeNounPlural.toLowerCase()}.`));
        return;
      }
      const { items } = await res.json();
      const enriched = await Promise.all(
        items.map(async (base): Promise<EnrichedInitiative> => {
          const detailRes = await api.v1.orgs[':orgId'].initiatives[':id'].$get({
            param: { orgId, id: base.id },
          });
          return toEnriched(base, detailRes.ok ? await detailRes.json() : null);
        }),
      );
      setInitiatives(enriched);
    } catch (caught) {
      setError(
        readError(caught, `Something went wrong loading ${initiativeNounPlural.toLowerCase()}.`),
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, initiativeNounPlural]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Create a new theme from the name, then route to its (empty) timeline-first detail. */
  const createInitiative = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.v1.orgs[':orgId'].initiatives.$post({
        param: { orgId },
        json: { name: trimmed },
      });
      if (!res.ok) {
        setCreateError(await readProblem(res, `Could not create the ${initiativeNounLower}.`));
        return;
      }
      const created = await res.json();
      setName('');
      router.push(`/orgs/${orgId}/initiatives/${created.id}`);
    } catch (caught) {
      setCreateError(
        readError(caught, `Something went wrong creating the ${initiativeNounLower}.`),
      );
    } finally {
      setCreating(false);
    }
  }, [name, orgId, initiativeNounLower, router]);

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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{initiativeNounPlural}</h1>
        <p className="text-muted-foreground text-sm">
          Cross-cutting themes that roll up the health of the {programNoun}s and {projectNoun}s
          beneath them — no work lives here directly.
        </p>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void createInitiative();
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex gap-2">
          <Input
            aria-label={`New ${initiativeNounLower} name`}
            placeholder={`Name a new ${initiativeNounLower}…`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Button type="submit" disabled={creating || name.trim().length === 0} className="gap-1.5">
            <Plus aria-hidden="true" className="size-4" />
            {creating ? 'Creating…' : `New ${initiativeNoun}`}
          </Button>
        </div>
        {createError ? (
          <p role="alert" className="text-destructive text-sm">
            {createError}
          </p>
        ) : null}
      </form>

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
          <Skeleton className="h-[88px] w-full rounded-xl" />
        </div>
      ) : error ? (
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {error}
        </p>
      ) : sections.length === 0 ? (
        <div className="border-border text-muted-foreground rounded-xl border border-dashed p-10 text-center">
          <Target aria-hidden="true" className="mx-auto mb-3 size-6 opacity-60" />
          <p className="text-foreground text-sm font-medium">
            No {initiativeNounPlural.toLowerCase()} yet
          </p>
          <p className="mt-1 text-sm">
            Create a theme above to start grouping {programNoun}s and {projectNoun}s into a roadmap.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <section
              key={section.status}
              aria-label={SECTION_LABEL[section.status]}
              className="flex flex-col gap-2.5"
            >
              <h2 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                {SECTION_LABEL[section.status]}
                <span className="tabular-nums">{section.items.length}</span>
              </h2>
              <ul className="flex flex-col gap-2.5">
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
