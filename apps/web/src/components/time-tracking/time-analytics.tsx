'use client';

/**
 * The reflection surface: how long a period was, and where it went.
 *
 * @remarks
 * Three things, in the order a person asks them — *how much*, *on what*, *shown how* — and
 * nothing else. Sunsama and Toggl are the reference for restraint, not for feature count: one
 * period, one total, one ranked list. No stacked charts, no comparison mode, no goals. A ranked
 * list of bars is the one form where "where did the week go" is answerable at a glance and the
 * numbers are still exact.
 *
 * The headline measure is **combined effort**, not elapsed wall clock. Elapsed merges overlapping
 * spans so parallel human and agent work is not double counted, which means it has no per-bucket
 * decomposition; publishing it as the total beside buckets that do decompose would show a column
 * of numbers that visibly fail to add up.
 */
import { Button, Chip, ControlGroup, Text, Toolbar } from '@docket/ui/primitives';
import { BarChart, Filter, Schedule } from '@docket/ui/icons';
import { type JSX, useMemo, useState } from 'react';

import Link from '@/components/docket-link';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

import { formatDuration, spokenDuration } from './format-duration';

/** The periods the surface offers, shortest first. */
const PERIODS = [
  { id: 'today', label: 'Today', days: 1 },
  { id: 'week', label: 'This week', days: 7 },
  { id: 'month', label: 'Last 30 days', days: 30 },
] as const;

/** A period identifier. */
type PeriodId = (typeof PERIODS)[number]['id'];

/** The dimensions the author named, in hierarchy order, plus the two personal ones. */
const DIMENSIONS = [
  { id: 'project', label: 'Project' },
  { id: 'program', label: 'Program' },
  { id: 'initiative', label: 'Initiative' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'task', label: 'Task' },
  { id: 'category', label: 'Category' },
] as const;

/** A breakdown dimension identifier. */
type DimensionId = (typeof DIMENSIONS)[number]['id'];

/** Resolve a period to the UTC bounds the API takes. */
function boundsFor(period: PeriodId, now: Date): { start: string; end: string } {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime());
  const days = PERIODS.find((entry) => entry.id === period)?.days ?? 1;
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - days);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

/** One bucket row. */
interface BreakdownBucket {
  readonly key: string;
  readonly label: string;
  readonly measures: { readonly combinedEffortMs: number; readonly humanEffortMs: number };
}

/**
 * The time-reports surface.
 *
 * @returns the analytics page body.
 */
export function TimeAnalytics(): JSX.Element {
  const [period, setPeriod] = useState<PeriodId>('week');
  const [dimension, setDimension] = useState<DimensionId>('project');

  // Recomputed only when the period changes, so the query key is stable across renders and the
  // surface does not refetch once a second just because `now` moved.
  const range = useMemo(() => boundsFor(period, new Date()), [period]);
  const params = `${range.start}|${range.end}`;

  const summaryQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeSummary(params),
      () => api.v1.time.summary.$get({ query: range }),
      'Could not load your time.',
      { staleTime: STALE.volatile },
    ),
  );
  const breakdownQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeBreakdown(`${params}|${dimension}`),
      () => api.v1.time.breakdown.$get({ query: { ...range, groupBy: dimension } }),
      'Could not load your time breakdown.',
      { staleTime: STALE.volatile },
    ),
  );

  const total = summaryQ.data?.combinedEffortMs ?? 0;
  const buckets = ((breakdownQ.data?.buckets ?? []) as BreakdownBucket[]).filter(
    (bucket) => bucket.measures.combinedEffortMs > 0,
  );
  const largest = buckets[0]?.measures.combinedEffortMs ?? 0;
  const error = summaryQ.error ?? breakdownQ.error;
  const loading = summaryQ.isPending || breakdownQ.isPending;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-6">
      {/* Period is a property of the whole page, so it sits in the toolbar. The breakdown
          dimension is a property of the LIST alone and there are six of them, so it sits on the
          list instead — crowding both runs of chips into one bar truncated their labels at exactly
          the width where the rail is open, which is the common case.

          The heading is a page heading, not a toolbar control, and it stays outside the bar for a
          concrete reason: `Toolbar` lets its trailing run keep its width and squeezes the leading
          one, so at 390px the title was pushed to zero width and disappeared — a page with no
          heading at all. Out here it is unconditional at every width. */}
      <Text as="h1" token="headline-small">
        Time
      </Text>
      <Toolbar
        controlSize="md"
        leading={
          <ControlGroup controlSize="md" wrap>
            {PERIODS.map((entry) => (
              <Chip
                key={entry.id}
                variant="filter"
                icon={<Schedule aria-hidden="true" />}
                selected={period === entry.id}
                onClick={() => {
                  setPeriod(entry.id);
                }}
              >
                {entry.label}
              </Chip>
            ))}
          </ControlGroup>
        }
      />

      <div className="bg-surface-container-low flex min-w-0 items-baseline gap-3 rounded-xl px-6 py-5">
        <Text token="display-small" numeric aria-label={`${spokenDuration(total)} tracked`}>
          {formatDuration(total)}
        </Text>
        <Text token="body-medium" tone="muted">
          tracked {PERIODS.find((entry) => entry.id === period)?.label.toLowerCase()}
        </Text>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <Text as="h2" token="title-small" tone="muted">
          Break down by
        </Text>
        <ControlGroup controlSize="md" wrap>
          {DIMENSIONS.map((entry) => (
            <Chip
              key={entry.id}
              variant="filter"
              icon={<Filter aria-hidden="true" />}
              selected={dimension === entry.id}
              onClick={() => {
                setDimension(entry.id);
              }}
            >
              {entry.label}
            </Chip>
          ))}
        </ControlGroup>
      </div>

      {error ? (
        <div role="alert" className="bg-error-container text-on-error-container rounded-xl p-6">
          <Text token="body-medium">
            {userErrorMessage(error, 'Could not load your time reports.')}
          </Text>
        </div>
      ) : loading ? (
        <Text token="body-medium" tone="muted">
          Loading your time…
        </Text>
      ) : buckets.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex min-w-0 flex-col" aria-label={`Time by ${dimension}`}>
          {buckets.map((bucket) => {
            const share = largest > 0 ? (bucket.measures.combinedEffortMs / largest) * 100 : 0;
            const ofTotal =
              total > 0 ? Math.round((bucket.measures.combinedEffortMs / total) * 100) : 0;
            return (
              <li
                key={bucket.key}
                className="hover:bg-surface-container-low flex h-12 min-w-0 items-center gap-4 rounded-md px-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Text token="body-medium" truncate>
                    {bucket.label}
                  </Text>
                  {/* A proportion bar, not a chart: the row itself IS the comparison, so the
                      widest bar is the biggest bucket and no legend is needed to read it. */}
                  <div
                    aria-hidden="true"
                    className="bg-surface-container-high h-1 w-full overflow-hidden rounded-full"
                  >
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${Math.max(2, share)}%` }}
                    />
                  </div>
                </div>
                <Text token="body-small" tone="muted" numeric className="w-10 shrink-0 text-right">
                  {ofTotal}%
                </Text>
                <Text
                  token="label-large"
                  numeric
                  className="w-20 shrink-0 text-right"
                  aria-label={spokenDuration(bucket.measures.combinedEffortMs)}
                >
                  {formatDuration(bucket.measures.combinedEffortMs)}
                </Text>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * What the surface says when nothing was tracked.
 *
 * @remarks
 * States the fact and offers the one action that changes it. It does not apologise, and it does
 * not imply something went wrong: a period with no tracked time is an ordinary answer.
 */
function EmptyState(): JSX.Element {
  return (
    <div className="bg-surface-container-low flex min-w-0 flex-col items-start gap-3 rounded-xl px-6 py-10">
      <BarChart aria-hidden="true" className="text-on-surface-variant size-6" />
      <Text token="title-medium">No time tracked in this period</Text>
      <Text as="p" token="body-medium" tone="muted" className="max-w-prose">
        Start the timer from anywhere — the control in the sidebar, or the track button on any task
        — and every segment you record will show up here, grouped however you like.
      </Text>
      <Button variant="secondary" asChild>
        <Link href="/today">Go find something to work on</Link>
      </Button>
    </div>
  );
}
