'use client';

/**
 * The Cycles list (product §8.5).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/cycles`. It lists the org's time-boxed
 * cadences in three segments — **Current** (the live, `active` cadence), **Upcoming**
 * (planned but not yet started), and **Completed** (already rolled). The cycles list read
 * (`GET …/cycles`) returns the cycles newest-first; each is summarized as a {@link CycleRow}
 * that links to its detail.
 *
 * A cycle's pace numbers (committed/completed, capacity, carryover) live on the single-cycle
 * read, not the list, so the page fetches each cycle's `…/cycles/:id` stats in parallel after
 * the list lands and threads them into the rows as they arrive — the rows show a slim
 * skeleton until then, so nothing jumps. The cycle noun routes through {@link useVocabulary}
 * so an org's skin (e.g. "Sprint") shows through. Data is fetched at runtime, so the
 * production build needs no running server.
 */
import type { CycleOut, CycleStats } from '@docket/types';
import { EntityList } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Plus, RefreshCw } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { CreateCycleDialog } from '@/components/cycles/create-cycle';
import { CycleRow } from '@/components/cycles/cycle-row';
import { CYCLE_SEGMENTS, SEGMENT_LABEL, segmentOf } from '@/components/cycles/cycle-status';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/**
 * The org Cycles list page.
 */
export default function CyclesPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  const { teams, defaultTeamId, teamsLoading } = useActiveOrg();

  const cycleNoun = useVocabulary('cycle');
  const cycleNounPlural = useVocabulary('cycle', { plural: true });

  const [cycles, setCycles] = useState<readonly CycleOut[]>([]);
  const [statsById, setStatsById] = useState<ReadonlyMap<string, CycleStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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
      // it lands so the rows fill without blocking the list's first paint.
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

  /** Prepend the freshly-created cycle to the roster, then open its detail. */
  const handleCreated = useCallback(
    (created: CycleOut): void => {
      setCycles((current) => [created, ...current]);
      router.push(`/orgs/${orgId}/cycles/${created.id}`);
    },
    [orgId, router],
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">
            {cycleNounPlural}
          </h1>
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

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-xl border p-4 text-sm"
        >
          {loadError}
        </p>
      ) : total === 0 ? (
        <div className="border-outline-variant flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
          <span className="bg-surface-container text-on-surface-variant mb-1 flex size-10 items-center justify-center rounded-full">
            <RefreshCw aria-hidden="true" className="size-5" />
          </span>
          <p className="text-on-surface text-sm font-medium">
            No {cycleNounPlural.toLowerCase()} yet
          </p>
          <p className="text-on-surface-variant max-w-sm text-sm">
            Start a {cycleNoun.toLowerCase()} to time-box your team&apos;s work and track its pace
            and carryover at a glance.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-1 gap-1.5"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Create your first {cycleNoun.toLowerCase()}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
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
                    className="text-on-surface-variant text-xs font-medium"
                  >
                    {SEGMENT_LABEL[segment]}
                  </h2>
                  <span className="text-on-surface-variant text-xs tabular-nums">
                    {inSegment.length}
                  </span>
                </div>
                <EntityList
                  aria-label={`${SEGMENT_LABEL[segment]} ${cycleNounPlural.toLowerCase()}`}
                >
                  {inSegment.map((cycle) => (
                    <CycleRow
                      key={cycle.id}
                      cycle={cycle}
                      stats={statsById.get(cycle.id) ?? null}
                      cycleNoun={cycleNoun}
                      href={`/orgs/${orgId}/cycles/${cycle.id}`}
                    />
                  ))}
                </EntityList>
              </section>
            );
          })}
        </div>
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
