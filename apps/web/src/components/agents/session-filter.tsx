'use client';

/**
 * The status filter for the Agents (sessions) feed — a styled `@docket/ui` DropdownMenu
 * (never a bare `<select>`).
 *
 * @remarks
 * Filters the live feed to a single lifecycle bucket — Running, Needs approval, Done, or
 * Errored — or to All. Each bucket maps to one or more {@link SessionStatus} values
 * (`Done` folds in canceled runs; `Running` folds in queued/paused in-flight states) so the
 * feed's four headline filters stay legible while still covering the full lifecycle. The
 * active bucket shows a check; the trigger reads as a calm, bordered control with a leading
 * filter glyph and a focus ring.
 */
import type { SessionStatus } from '@docket/types';
import { ChevronDown, Filter } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/** The headline feed buckets (a superset of {@link SessionStatus} folded for legibility). */
export type SessionFilter = 'all' | 'running' | 'awaiting_approval' | 'done' | 'errored';

/** Ordered filter options with their labels (drives the menu + the trigger label). */
const FILTER_OPTIONS: readonly { value: SessionFilter; label: string }[] = [
  { value: 'all', label: 'All sessions' },
  { value: 'running', label: 'Running' },
  { value: 'awaiting_approval', label: 'Needs approval' },
  { value: 'done', label: 'Done' },
  { value: 'errored', label: 'Errored' },
];

/** Resolve a filter bucket to its human label (used by the trigger). */
function labelOf(filter: SessionFilter): string {
  return FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? 'All sessions';
}

/**
 * Map a feed filter bucket to the concrete {@link SessionStatus} values it includes.
 *
 * @remarks
 * `all` returns `null` (no status predicate). `running` folds the in-flight states
 * (running + queued + paused) so a session in any active phase stays visible. `done` folds
 * `completed` and `canceled`; `errored` is `failed` alone; `awaiting_approval` is the single
 * human-review state. Callers filter the client-side session list against the returned set.
 *
 * @param filter - The selected feed bucket.
 * @returns the set of statuses the bucket matches, or `null` to match everything.
 */
export function statusesForFilter(filter: SessionFilter): ReadonlySet<SessionStatus> | null {
  switch (filter) {
    case 'all':
      return null;
    case 'running':
      return new Set<SessionStatus>(['running', 'pending', 'awaiting_input']);
    case 'awaiting_approval':
      return new Set<SessionStatus>(['awaiting_approval']);
    case 'done':
      return new Set<SessionStatus>(['completed', 'canceled']);
    case 'errored':
      return new Set<SessionStatus>(['failed']);
  }
}

/** Props for {@link SessionFilterMenu}. */
export interface SessionFilterMenuProps {
  /** The active filter bucket. */
  value: SessionFilter;
  /** Per-bucket counts (drives the trailing count in each menu row). */
  counts: Record<SessionFilter, number>;
  /** Called with the newly selected bucket. */
  onChange: (filter: SessionFilter) => void;
}

/**
 * The feed's status-filter control: a styled dropdown of lifecycle buckets.
 *
 * @example
 * ```tsx
 * <SessionFilterMenu value={filter} counts={counts} onChange={setFilter} />
 * ```
 */
export function SessionFilterMenu({
  value,
  counts,
  onChange,
}: SessionFilterMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-4 w-4" />
          <span>{labelOf(value)}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            onChange(next as SessionFilter);
          }}
        >
          {FILTER_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span className="flex w-full items-center justify-between gap-6">
                <span>{option.label}</span>
                <span className="text-on-surface-variant text-xs tabular-nums">
                  {counts[option.value]}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
