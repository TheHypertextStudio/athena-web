'use client';

/**
 * The Cycles list (product §8.5).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/cycles`. It lists the org's time-boxed
 * cadences in three segments — **Current** (the live, `active` cadence), **Upcoming**
 * (planned but not yet started), and **Completed** (already rolled). The cycles list read
 * (`GET …/cycles`) returns the cycles newest-first; each is summarized as a {@link CycleCard}
 * that links to its detail.
 *
 * A cycle's pace numbers (committed/completed, capacity, carryover) live on the single-cycle
 * read, not the list, so the page fetches each cycle's `…/cycles/:id` stats in parallel after
 * the list lands and threads them into the cards as they arrive — the cards show a slim
 * skeleton until then, so nothing jumps. The cycle noun routes through {@link useVocabulary}
 * so an org's skin (e.g. "Sprint") shows through. Data is fetched at runtime, so the
 * production build needs no running server.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Skeleton } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { CycleCard } from '@/components/cycles/cycle-card';
import { CYCLE_SEGMENTS, SEGMENT_LABEL, segmentOf } from '@/components/cycles/cycle-status';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/**
 * The org Cycles list page.
 */
export default function CyclesPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const cycleNoun = useVocabulary('cycle');
  const cycleNounPlural = useVocabulary('cycle', { plural: true });

  const [cycles, setCycles] = useState<readonly CycleOut[]>([]);
  const [statsById, setStatsById] = useState<ReadonlyMap<string, CycleStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Load the org's cycles, then their per-cycle stats in parallel. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } });
      if (!res.ok) {
        setLoadError(await readProblem(res, 'Could not load your cycles.'));
        return;
      }
      const { items } = await res.json();
      setCycles(items);
      setLoading(false);

      // Pace numbers live on the single-cycle read; fetch them per cycle and thread each in as
      // it lands so the cards fill without blocking the list's first paint.
      await Promise.all(
        items.map(async (cycle) => {
          const detailRes = await api.v1.orgs[':orgId'].cycles[':id'].$get({
            param: { orgId, id: cycle.id },
          });
          if (!detailRes.ok) return;
          const detail = await detailRes.json();
          setStatsById((current) => {
            const next = new Map(current);
            next.set(cycle.id, detail.stats);
            return next;
          });
        }),
      );
    } catch (caught) {
      setLoadError(readError(caught, 'Something went wrong loading your cycles.'));
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Partition the cycles into the three list segments (preserving the API's newest-first order). */
  const segments = useMemo(() => {
    const bySegment = new Map<(typeof CYCLE_SEGMENTS)[number], CycleOut[]>(
      CYCLE_SEGMENTS.map((segment) => [segment, []]),
    );
    for (const cycle of cycles) {
      bySegment.get(segmentOf(cycle.status))?.push(cycle);
    }
    return bySegment;
  }, [cycles]);

  const total = cycles.length;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{cycleNounPlural}</h1>
        <p className="text-muted-foreground text-sm">
          Time-boxed cadences for your team — what&apos;s live now, what&apos;s coming up, and
          what&apos;s wrapped.
        </p>
      </header>

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {loadError}
        </p>
      ) : total === 0 ? (
        <div className="border-border/60 flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-12 text-center">
          <p className="text-foreground text-sm font-medium">
            No {cycleNounPlural.toLowerCase()} yet
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            When your team starts a {cycleNoun.toLowerCase()}, it shows up here with its pace and
            carryover at a glance.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {CYCLE_SEGMENTS.map((segment) => {
            const inSegment = segments.get(segment) ?? [];
            if (inSegment.length === 0) return null;
            return (
              <section
                key={segment}
                aria-labelledby={`cycles-${segment}`}
                className="flex flex-col gap-3"
              >
                <div className="flex items-center gap-2">
                  <h2
                    id={`cycles-${segment}`}
                    className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
                  >
                    {SEGMENT_LABEL[segment]}
                  </h2>
                  <span className="text-muted-foreground/70 text-xs tabular-nums">
                    {inSegment.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {inSegment.map((cycle) => (
                    <CycleCard
                      key={cycle.id}
                      cycle={cycle}
                      stats={statsById.get(cycle.id) ?? null}
                      cycleNoun={cycleNoun}
                      href={`/orgs/${orgId}/cycles/${cycle.id}`}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Loading placeholder for the list: two labeled segments of cycle cards. */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
