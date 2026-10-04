'use client';

/** Compact navigation to the selected work entry in the ongoing conversation. */
import { Button, ControlGroup, Tabs, type TabsItem } from '@docket/ui/primitives';
import { type JSX, useMemo } from 'react';

import {
  athenaQueueState,
  type AthenaQueueState,
  type PersonalAthenaSessionSummary,
} from '@/lib/athena/presentation';
import { type PersonalAthenaTransport } from '@/lib/athena/query-defs';

import { relativeTime } from '@docket/ui';
import { RelativeTime } from '@docket/ui/components';

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
  /** The entry currently open in the conversation. */
  readonly selectedId?: string | undefined;
  /** Open a row in the conversation; navigation never fetches its own detail. */
  readonly onSelect?: ((jobId: string) => void) | undefined;
  /** Retained for existing callers; detail reads belong to the conversation. */
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
 * The Work picker: occupied filters followed by compact choices for the conversation.
 * Renders nothing when there is no work at all.
 */
export function AthenaWorkLedger({
  jobs,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
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
    <section
      aria-label="Work"
      data-slot="athena-work-ledger"
      className="flex min-w-0 flex-col gap-4"
    >
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
      <div className="flex flex-col gap-1">
        {visible.map((job) => (
          <Button
            key={job.id}
            variant={selectedId === job.id ? 'secondary' : 'ghost'}
            data-athena-work-row={job.id}
            aria-pressed={selectedId === job.id}
            className="h-auto min-h-12 w-full flex-col items-start gap-1 px-3 py-3 text-left whitespace-normal"
            onClick={() => {
              onSelect?.(job.id);
            }}
          >
            <span className="text-body-small line-clamp-2 w-full break-words">{job.objective}</span>
            <RelativeTime iso={job.updatedAt} className="text-on-surface-variant text-label-small">
              {relativeTime(job.updatedAt)}
            </RelativeTime>
          </Button>
        ))}
      </div>
    </section>
  );
}
