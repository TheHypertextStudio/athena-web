'use client';

/**
 * The focused **active-cycle overview** that heads the Cycles list.
 *
 * @remarks
 * The Cycles page used to be a filter toolbar over three equal-weight status groups, each an
 * identical table. The live cycle was one row distinguished only by a small badge, with a
 * four-row "Upcoming" group directly beneath it — so the thing a reader actually wants ("what is
 * running right now, and how is it going?") was the least prominent thing on screen, and the
 * answer to "how much is left" lived one click away on the detail route.
 *
 * This is that answer, inline: identity, window and runway, progress and workload, and the
 * cycle's own tasks. Subordination of the roster below is achieved by **weight**, not by hiding —
 * the active cycle still appears in the roster, so the filters stay honest.
 *
 * It deliberately introduces **no new layout system**. The region is the same
 * `bg-surface-container-low rounded-xl p-4` tonal panel `CycleRows` and `PropertyPanel` already
 * use, the tasks render through the shared {@link TaskTable} primitive with the shared
 * {@link buildTaskColumns} / {@link buildTaskCatalog} vocabulary, and every size resolves to an MD3
 * type token — there is no Cycles-only card, grid, or spacing constant here.
 */
import type { CycleOut, CycleStats, TaskOut } from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useMemo } from 'react';

import type { ActorDirectory } from '@/components/agents/actor-directory';
import { buildTaskCatalog } from '@/components/views/task-catalog';
import { resolveRelationLabel } from '@/components/views/field-catalog';
import { buildTaskColumns, TaskTable } from '@/components/views/task-table';
import { asNameMap, cycleDetailDef } from '@/lib/fetch-cycle-detail';
import { userErrorMessage } from '@/lib/problem';
import { useApiQuery, usePrefetchApi } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';

import { STATUS_LABEL, statusBadgeVariant } from './cycle-status';
import { formatWindow, windowProgress, windowRunway } from './format-window';

/** How many of the cycle's tasks the overview shows before deferring to the detail screen. */
const TASK_PREVIEW_LIMIT = 8;

/** The fallback actor used until the directory resolves (never renders a raw id). */
const UNKNOWN_ACTOR: ReturnType<ActorDirectory['resolve']> = { name: 'Someone', kind: 'human' };

/**
 * Pick the cycle a workspace is currently running.
 *
 * @remarks
 * `isCurrent` is the date-derived signal and the source of truth ("which window contains today"),
 * because cycles auto-roll and the stored `status` is only seeded at generation time. A read that
 * did not resolve a window omits the flag entirely, so the stored `status` is the fallback rather
 * than the primary test.
 *
 * @param cycles - The loaded roster.
 * @returns the active cycle, or `null` when nothing is running.
 */
export function findActiveCycle(cycles: readonly CycleOut[]): CycleOut | null {
  return (
    cycles.find((c) => c.isCurrent === true) ?? cycles.find((c) => c.status === 'active') ?? null
  );
}

/**
 * Application-owned runway copy for a cycle window, addressed by its ISO bounds.
 *
 * @remarks
 * A thin binding over {@link windowRunway}, which is the single implementation of this sentence and
 * lives beside the window arithmetic it reads. The overview holds a `CycleOut` (two ISO strings)
 * while the detail masthead already holds the computed progress, so this exists only to spare the
 * caller the intermediate {@link windowProgress} step — the wording itself is not duplicated.
 *
 * @param startsAt - ISO window start.
 * @param endsAt - ISO window end.
 * @param now - Reference instant, injectable for deterministic tests.
 * @returns the runway phrase, e.g. `"Day 5 of 7 · 2 days left"`.
 */
export function runwayLabel(startsAt: string, endsAt: string, now?: Date): string {
  return windowRunway(
    now ? windowProgress(startsAt, endsAt, now) : windowProgress(startsAt, endsAt),
  );
}

/** Props for {@link ActiveCycleOverview}. */
export interface ActiveCycleOverviewProps {
  /** The owning organization id (from the route). */
  readonly orgId: string;
  /** The cycle currently running — see {@link findActiveCycle}. */
  readonly cycle: CycleOut;
  /**
   * The owning team's display name.
   *
   * @remarks
   * A multi-team workspace can have several teams each correctly running their own current
   * cadence; {@link findActiveCycle} surfaces only one of them here. Naming its team keeps
   * this overview from reading as *the* org-wide active cycle when it is really one team's.
   */
  readonly teamName: string;
  /** The cycle's pace stats from the roster read, or `null` while they load. */
  readonly stats: CycleStats | null;
  /** The vocabulary-skinned singular cycle noun (e.g. "Cycle", "Sprint"). */
  readonly cycleNoun: string;
}

/**
 * The focused overview of the workspace's active cycle.
 *
 * @param props - The {@link ActiveCycleOverviewProps}.
 * @returns the rendered overview region.
 */
export function ActiveCycleOverview({
  orgId,
  cycle,
  teamName,
  stats,
  cycleNoun,
}: ActiveCycleOverviewProps): JSX.Element {
  const router = useRouter();
  const prefetch = usePrefetchApi();
  const projectNoun = useVocabulary('project');
  const programNoun = useVocabulary('program');
  const cycleNounLower = cycleNoun.toLowerCase();
  const detailHref = `/orgs/${orgId}/cycles/${cycle.id}`;

  // The cycle's tasks come from the same cache entry the detail route and the roster's hover
  // prefetch use, so opening the cycle from here is instant and the two surfaces never disagree.
  const detailQ = useApiQuery(
    cycleDetailDef(orgId, cycle.id, `Could not load this ${cycleNounLower}'s work.`),
  );
  const tasks = useMemo<readonly TaskOut[]>(() => detailQ.data?.tasks ?? [], [detailQ.data]);
  // Normalized rather than read straight off the cache entry: the persisted query cache round-trips
  // through JSON, which has no `Map`, so on any load after the first these arrive as plain objects
  // and a bare `.get()` throws (see {@link asNameMap}). The detail route reads them the same way.
  const projectName = useMemo(() => asNameMap(detailQ.data?.projectName), [detailQ.data]);
  const programName = useMemo(() => asNameMap(detailQ.data?.programName), [detailQ.data]);
  const resolveActor = useMemo<ActorDirectory['resolve']>(
    () => detailQ.data?.resolveActor ?? (() => UNKNOWN_ACTOR),
    [detailQ.data],
  );

  const columns = useMemo(() => {
    const catalog = buildTaskCatalog({
      projectLabel: projectNoun,
      programLabel: programNoun,
      resolveProject: (id) =>
        resolveRelationLabel(id, detailQ.isPending, (i) => projectName.get(i)),
      resolveProgram: (id) =>
        resolveRelationLabel(id, detailQ.isPending, (i) => programName.get(i)),
      resolveAssignee: (id) => resolveActor(id).name,
      assigneeOptions: () => [],
      projectOptions: () => [],
      programOptions: () => [],
    });
    return buildTaskColumns({
      catalog,
      resolveActor: (id) => resolveActor(id),
      onOpen: (task) => {
        router.push(`/orgs/${orgId}/tasks/${task.id}`);
      },
    });
  }, [
    projectNoun,
    programNoun,
    projectName,
    programName,
    detailQ.isPending,
    resolveActor,
    router,
    orgId,
  ]);

  const preview = useMemo(() => tasks.slice(0, TASK_PREVIEW_LIMIT), [tasks]);

  const taskPct =
    stats && stats.committed > 0 ? Math.round((stats.completed / stats.committed) * 100) : 0;

  return (
    <section
      aria-labelledby="active-cycle-heading"
      className="bg-surface-container-low flex flex-col gap-4 rounded-xl p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="active-cycle-heading" className="text-on-surface text-title-large min-w-0">
          {cycle.displayName}
        </h2>
        <Badge variant={statusBadgeVariant('active')}>{STATUS_LABEL.active}</Badge>
        <span className="text-on-surface-variant text-label-large">{teamName}</span>
        <Link
          href={detailHref}
          className="text-primary text-label-large ml-auto shrink-0 hover:underline"
        >
          Open {cycleNounLower}
        </Link>
      </div>

      {/* Dates + runway. The window is repeated here only when it is not already the heading:
          an unnamed cycle's `displayName` IS its window, and printing "Jul 27 – Aug 2" twice, one
          line apart, reads as a rendering bug rather than as two facts. Either way the region
          states the start and end dates and the time remaining. */}
      <p className="text-on-surface-variant text-body-medium">
        {cycle.name ? `${formatWindow(cycle.startsAt, cycle.endsAt)} · ` : ''}
        {runwayLabel(cycle.startsAt, cycle.endsAt)}
      </p>

      <dl className="flex flex-col gap-4 @lg:flex-row @lg:flex-wrap @lg:items-start @lg:gap-10">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-on-surface-variant text-label-medium">Progress</dt>
          <dd className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="bg-surface-container-highest h-1.5 w-24 overflow-hidden rounded-full"
            >
              <span
                className="bg-primary block h-full rounded-full"
                style={{ width: `${taskPct}%` }}
              />
            </span>
            {stats ? (
              <span className="text-on-surface text-title-medium tabular-nums">
                {stats.completed}/{stats.committed} tasks done
              </span>
            ) : (
              // placeholder: this cycle's committed/completed counts, which arrive with the roster.
              <Skeleton className="h-5 w-28" />
            )}
          </dd>
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-on-surface-variant text-label-medium">Workload</dt>
          <dd className="text-on-surface text-title-medium tabular-nums">
            {stats ? (
              // "points" spelled out, not "pts": the unit has to be readable the first time.
              `${String(stats.completedCapacity)}/${String(stats.capacity)} points`
            ) : (
              <Skeleton className="h-5 w-24" />
            )}
          </dd>
        </div>

        {stats && stats.carryover > 0 ? (
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-on-surface-variant text-label-medium">Carryover</dt>
            <dd className="text-state-started text-title-medium tabular-nums">
              {stats.carryover} still open
            </dd>
          </div>
        ) : null}
      </dl>

      {detailQ.isPending ? (
        // placeholder: the cycle's committed tasks — their titles, states and assignees. They are
        // the cycle's own record and cannot be named before the read lands.
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
      ) : detailQ.isError ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(detailQ.error, `Could not load this ${cycleNounLower}'s work.`)}
        </p>
      ) : preview.length === 0 ? (
        <p className="text-on-surface-variant text-body-medium">
          Nothing is committed to this {cycleNounLower} yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <TaskTable
            label={`${cycle.displayName} tasks`}
            columns={columns}
            tasks={preview}
            taskHref={(task) => `/orgs/${orgId}/tasks/${task.id}`}
            onRowPrefetch={(task) => {
              prefetch(taskDetailDef(orgId, task.id));
            }}
            onOpenTask={(task) => {
              router.push(`/orgs/${orgId}/tasks/${task.id}`);
            }}
          />
          {tasks.length > preview.length ? (
            <Link
              href={detailHref}
              className="text-primary text-label-large self-start hover:underline"
            >
              View all {tasks.length} tasks
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}
