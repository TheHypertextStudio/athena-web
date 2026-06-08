'use client';

/**
 * Program status presentation — the lifecycle badge, the health pill, and the styled
 * status-filter control for the Programs list.
 *
 * @remarks
 * Programs are *ongoing* operations, so their lifecycle is `active | paused | archived`
 * (there is intentionally no `completed` — see {@link ProgramStatus}). `active` reads as the
 * default emphasis; `paused`/`archived` read as muted/quiet so a long roster scans by
 * weight. The filter is a real `@docket/ui` {@link DropdownMenu} (never a bare `<select>`):
 * a calm bordered trigger with a leading filter glyph, a focus ring, and a check on the
 * active bucket.
 */
import type { Health, ProgramStatus } from '@docket/types';
import { cn } from '@docket/ui';
import { ChevronDown, Filter } from '@docket/ui/icons';
import {
  Badge,
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

import { HEALTH_DOT_CLASS, HEALTH_LABEL, HEALTH_PILL_CLASS } from './health';

/** Human label for each Program lifecycle status. */
export const STATUS_LABEL: Record<ProgramStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

/** Only `active` carries the solid (default) badge; quiet statuses read muted. */
function statusBadgeVariant(status: ProgramStatus): 'default' | 'secondary' {
  return status === 'active' ? 'default' : 'secondary';
}

/** Props for {@link ProgramStatusBadge}. */
export interface ProgramStatusBadgeProps {
  /** The program's lifecycle status. */
  status: ProgramStatus;
}

/** A small badge rendering a Program's lifecycle status. */
export function ProgramStatusBadge({ status }: ProgramStatusBadgeProps): JSX.Element {
  return <Badge variant={statusBadgeVariant(status)}>{STATUS_LABEL[status]}</Badge>;
}

/** Props for {@link HealthPill}. */
export interface HealthPillProps {
  /** The health verdict, or `null` when unset. */
  health: Health | null;
}

/** A compact pill rendering a Program's health verdict (or a neutral "No health set"). */
export function HealthPill({ health }: HealthPillProps): JSX.Element {
  if (!health) {
    return (
      <span className="text-on-surface-variant bg-surface-container ring-outline-variant inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset">
        <span aria-hidden="true" className="bg-on-surface-variant/60 size-1.5 rounded-full" />
        No health set
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        HEALTH_PILL_CLASS[health],
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[health])} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** The list's status-filter buckets (all lifecycle statuses, plus "all"). */
export type StatusFilter = 'all' | ProgramStatus;

/** Ordered filter options with their labels (drives the menu + the trigger label). */
const FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

/** Resolve a filter bucket to its human label (used by the trigger). */
function labelOf(filter: StatusFilter): string {
  return FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? 'All';
}

/** Props for {@link StatusFilterMenu}. */
export interface StatusFilterMenuProps {
  /** The active filter bucket. */
  value: StatusFilter;
  /** Per-bucket counts (drives the trailing count in each menu row). */
  counts: Record<StatusFilter, number>;
  /** Called with the newly selected bucket. */
  onChange: (filter: StatusFilter) => void;
}

/**
 * The list's status-filter control: a styled dropdown of lifecycle buckets.
 *
 * @example
 * ```tsx
 * <StatusFilterMenu value={filter} counts={counts} onChange={setFilter} />
 * ```
 */
export function StatusFilterMenu({ value, counts, onChange }: StatusFilterMenuProps): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-4 w-4" />
          <span>{labelOf(value)}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            onChange(next as StatusFilter);
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
