'use client';

/**
 * `athena-work-ledger` — the wide view's history of delegated work.
 *
 * @remarks
 * Lists the workspace's work behind three filters — Running, Needs you, Done — per §4.7 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`. Each row is the same flat work
 * entry the thread renders ({@link AthenaJobCard}), so a ledger row and a thread entry are
 * recognisably the same object, and the ledger is the one place on `/athena` that entry lives.
 *
 * A filter with nothing in it is hidden rather than shown with a zero, and there are no counts: the
 * entries under the active filter already say how many there are. When the chosen filter empties
 * out, the ledger falls back to the first filter that has work, waiting work first. It is a
 * controlled list: the active filter is reported to the caller rather than owned here.
 */
import { ControlGroup, Tabs, type TabsItem } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import {
  athenaQueueState,
  type AthenaQueueState,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { personalAthenaTransport, type PersonalAthenaTransport } from '@/lib/athena/query-defs';

import { AthenaJobCard } from './athena-job-card';

/** The Work ledger's three filters. */
export type AthenaWorkLedgerFilter = 'running' | 'needs_you' | 'done';

/** Which ledger filter each queue lane belongs to. */
const FILTER_BY_QUEUE_STATE: Readonly<Record<AthenaQueueState, AthenaWorkLedgerFilter>> = {
  working: 'running',
  needs_you: 'needs_you',
  finished: 'done',
};

/** Fixed left-to-right order of the ledger's filters. */
const FILTER_ORDER: readonly AthenaWorkLedgerFilter[] = ['running', 'needs_you', 'done'];

/** The order a filter is chosen in when the chosen one has nothing in it: waiting work first. */
const FALLBACK_ORDER: readonly AthenaWorkLedgerFilter[] = ['needs_you', 'running', 'done'];

/** The plain-language label for each filter tab. */
const FILTER_LABEL: Readonly<Record<AthenaWorkLedgerFilter, string>> = {
  running: 'Running',
  needs_you: 'Needs you',
  done: 'Done',
};

/** Props for {@link AthenaWorkLedger}. */
export interface AthenaWorkLedgerProps {
  /** Every job in the workspace's queue; the ledger filters and sorts this itself. */
  readonly jobs: readonly PersonalAthenaSessionSummary[];
  /** The chosen filter (controlled by the caller). */
  readonly filter: AthenaWorkLedgerFilter;
  readonly onFilterChange: (filter: AthenaWorkLedgerFilter) => void;
  /** Transport each entry drives its own detail read and actions through. */
  readonly transport?: PersonalAthenaTransport | undefined;
}

/** The ledger filter a job is listed under, honouring a queue-reported lane over the derived one. */
export function ledgerFilterOf(job: PersonalAthenaSessionSummary): AthenaWorkLedgerFilter {
  return FILTER_BY_QUEUE_STATE[job.queueState ?? athenaQueueState(job.status)];
}

/** Newest-first comparator for the Done lane, by ISO `updatedAt`. */
function byUpdatedAtDescending(
  a: PersonalAthenaSessionSummary,
  b: PersonalAthenaSessionSummary,
): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * The filter the ledger shows: the chosen one while it has work, else the first that does.
 *
 * @returns the filter, or `null` when every lane is empty.
 */
export function resolveLedgerFilter(
  jobs: readonly PersonalAthenaSessionSummary[],
  filter: AthenaWorkLedgerFilter,
): AthenaWorkLedgerFilter | null {
  const occupied = new Set(jobs.map(ledgerFilterOf));
  if (occupied.has(filter)) return filter;
  return FALLBACK_ORDER.find((candidate) => occupied.has(candidate)) ?? null;
}

/** The entries under one filter, Done newest first and the other lanes in queue order. */
function jobsUnder(
  jobs: readonly PersonalAthenaSessionSummary[],
  filter: AthenaWorkLedgerFilter,
): readonly PersonalAthenaSessionSummary[] {
  const matches = jobs.filter((job) => ledgerFilterOf(job) === filter);
  return filter === 'done' ? [...matches].sort(byUpdatedAtDescending) : matches;
}

/**
 * The Work ledger: the filters that have work, then that filter's entries as flat work entries.
 * Renders nothing when there is no work at all.
 */
export function AthenaWorkLedger({
  jobs,
  filter,
  onFilterChange,
  transport = personalAthenaTransport,
}: AthenaWorkLedgerProps): JSX.Element | null {
  const active = resolveLedgerFilter(jobs, filter);
  const items: readonly TabsItem[] = useMemo(() => {
    const occupied = new Set(jobs.map(ledgerFilterOf));
    return FILTER_ORDER.filter((value) => occupied.has(value)).map((value) => ({
      value,
      label: FILTER_LABEL[value],
    }));
  }, [jobs]);
  const visible = useMemo(() => (active ? jobsUnder(jobs, active) : []), [jobs, active]);

  if (!active) return null;
  return (
    <section aria-label="Work" data-slot="athena-work-ledger" className="flex flex-col gap-6">
      {/* On a phone-width column the tab row scrolls inside itself rather than widening the page. */}
      <div className="overflow-x-auto">
        <ControlGroup controlSize="sm">
          <Tabs
            value={active}
            onValueChange={(next) => {
              onFilterChange(next as AthenaWorkLedgerFilter);
            }}
            items={items}
            label="Filter work"
          />
        </ControlGroup>
      </div>
      <div className="flex flex-col gap-8">
        {visible.map((job) => (
          <AthenaJobCard key={job.id} job={job} transport={transport} />
        ))}
      </div>
    </section>
  );
}
