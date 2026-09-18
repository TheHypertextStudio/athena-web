'use client';

/**
 * `athena-work-ledger` — the wide view's answer to "what has Athena done for me?"
 *
 * @remarks
 * Lists every job in the personal queue behind three filters — Running, Needs you, Done — per
 * §4.7 of `docs/superpowers/specs/2026-09-12-athena-companion-design.md`. It is a controlled list:
 * the active filter and every row click are reported to the caller rather than owned here, the
 * same shape the segmented control in `today-prompt.tsx` uses. Done sorts newest first; the other
 * two lanes keep the queue's own order. Clicking a row asks the caller to jump the thread to that
 * job's card.
 */
import { ControlGroup, Tabs, type TabsItem } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import { jobStatusLine } from '@/lib/athena/job-presentation';
import {
  athenaQueueState,
  type AthenaQueueState,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';

/** The Work ledger's three filters. */
export type AthenaWorkLedgerFilter = 'running' | 'needs_you' | 'done';

/** Which queue lane each ledger filter reads from. */
const QUEUE_STATE_BY_FILTER: Readonly<Record<AthenaWorkLedgerFilter, AthenaQueueState>> = {
  running: 'working',
  needs_you: 'needs_you',
  done: 'finished',
};

/** Fixed left-to-right order of the ledger's filters. */
const FILTER_ORDER: readonly AthenaWorkLedgerFilter[] = ['running', 'needs_you', 'done'];

/** The plain-language label for each filter tab. */
const FILTER_LABEL: Readonly<Record<AthenaWorkLedgerFilter, string>> = {
  running: 'Running',
  needs_you: 'Needs you',
  done: 'Done',
};

/** Short month/day formatting for a ledger row's date, e.g. "Jul 15". */
const ROW_DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** Props for {@link AthenaWorkLedger}. */
export interface AthenaWorkLedgerProps {
  /** Every job in the personal queue; the ledger filters and sorts this itself. */
  readonly jobs: readonly PersonalAthenaSessionSummary[];
  /** The active filter (controlled by the caller). */
  readonly filter: AthenaWorkLedgerFilter;
  readonly onFilterChange: (filter: AthenaWorkLedgerFilter) => void;
  /** Jump the thread to this job's card, invoked with the job's id. */
  readonly onOpen: (jobId: string) => void;
}

/** The lane a job belongs to, honouring a queue-reported lane over the derived one. */
function laneOf(job: PersonalAthenaSessionSummary): AthenaQueueState {
  return job.queueState ?? athenaQueueState(job.status);
}

/** Newest-first comparator for the Done lane, by ISO `updatedAt`. */
function byUpdatedAtDescending(
  a: PersonalAthenaSessionSummary,
  b: PersonalAthenaSessionSummary,
): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * The wide view's Work ledger: a segmented Running / Needs you / Done control with counts, and the
 * matching rows — objective, status line, and date — beneath it.
 */
export function AthenaWorkLedger({
  jobs,
  filter,
  onFilterChange,
  onOpen,
}: AthenaWorkLedgerProps): JSX.Element {
  const items: readonly TabsItem[] = useMemo(
    () =>
      FILTER_ORDER.map((value) => ({
        value,
        label: FILTER_LABEL[value],
        count: jobs.filter((job) => laneOf(job) === QUEUE_STATE_BY_FILTER[value]).length,
      })),
    [jobs],
  );

  const visible = useMemo(() => {
    const lane = QUEUE_STATE_BY_FILTER[filter];
    const matches = jobs.filter((job) => laneOf(job) === lane);
    return filter === 'done' ? [...matches].sort(byUpdatedAtDescending) : matches;
  }, [jobs, filter]);

  return (
    <div className="flex flex-col gap-3">
      {/*
       * The wide rail's left column runs as narrow as 280px, too tight for three MD3-default
       * (`xl`) tabs with trailing counts. `sm` shrinks the padding, gap, and label type token
       * enough to fit "Running · Needs you · Done" at that width; the `overflow-x-auto` wrapper
       * is the fallback for narrower windows still — the tab row scrolls inside itself rather
       * than clipping a label or pushing the page wider.
       */}
      <div className="overflow-x-auto">
        <ControlGroup controlSize="sm">
          <Tabs
            value={filter}
            onValueChange={(next) => {
              onFilterChange(next as AthenaWorkLedgerFilter);
            }}
            items={items}
            label="Filter Athena's work"
          />
        </ControlGroup>
      </div>
      <ul className="flex flex-col gap-1">
        {visible.map((job) => (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => {
                onOpen(job.id);
              }}
              className="hover:bg-surface-container flex w-full min-w-0 items-center gap-3 rounded-md p-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="text-on-surface text-body-medium block truncate">
                  {job.objective}
                </span>
                <span className="text-on-surface-variant text-body-small block truncate">
                  {jobStatusLine(null, job)}
                </span>
              </span>
              <span className="text-on-surface-variant text-body-small shrink-0">
                {ROW_DATE_FORMAT.format(new Date(job.updatedAt))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
