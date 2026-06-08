'use client';

/**
 * Project status presentation — the lifecycle badge, the health pill, and the styled
 * status-filter control for the Projects list.
 *
 * @remarks
 * A Project is a *bounded* effort, so its lifecycle is `planned | active | completed |
 * canceled` ({@link ProjectStatus}). `active` reads as the default emphasis; the other
 * statuses read as muted/quiet so a long roster scans by weight. The filter is a real
 * `@docket/ui` {@link DropdownMenu} (never a bare `<select>`): a calm bordered trigger with a
 * leading filter glyph, a focus ring, and a check on the active bucket.
 */
import type { Health, ProjectStatus } from '@docket/types';
import type { WorkflowStateType } from '@docket/ui/components';
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

/** Human label for each Project lifecycle status. */
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Only `active` carries the solid (default) badge; quiet statuses read muted. */
function statusBadgeVariant(status: ProjectStatus): 'default' | 'secondary' {
  return status === 'active' ? 'default' : 'secondary';
}

/**
 * The canonical workflow-state type each Project lifecycle status reads as, for the leading
 * {@link import('@docket/ui/components').StatusIcon | StatusIcon} glyph on a list row.
 *
 * @remarks
 * Maps the bounded-effort lifecycle onto the five shared state types so a Project row shows
 * the same glyph vocabulary as a task: `planned` is a dashed backlog ring, `active` the
 * in-progress dot, `completed` a check, and `canceled` the cancel mark. Unknown values fall
 * back to `unstarted` (a plain ring) so a forward-compatible status still renders a glyph.
 */
export function statusGlyphType(status: string): WorkflowStateType {
  switch (status) {
    case 'planned':
      return 'backlog';
    case 'active':
      return 'started';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
    default:
      return 'unstarted';
  }
}

/** The human label for a Project lifecycle status (defensive against unknown wire values). */
export function statusLabel(status: string): string {
  return (STATUS_LABEL as Record<string, string | undefined>)[status] ?? status;
}

/** Props for {@link ProjectStatusBadge}. */
export interface ProjectStatusBadgeProps {
  /** The project's lifecycle status (defensively typed as a string from the DTO). */
  status: string;
}

/** A small badge rendering a Project's lifecycle status. */
export function ProjectStatusBadge({ status }: ProjectStatusBadgeProps): JSX.Element {
  const known = (STATUS_LABEL as Record<string, string | undefined>)[status];
  return <Badge variant={statusBadgeVariant(status as ProjectStatus)}>{known ?? status}</Badge>;
}

/** Props for {@link HealthPill}. */
export interface HealthPillProps {
  /** The health verdict, or `null` when unset. */
  health: Health | null;
}

/** A compact pill rendering a Project's health verdict (or a neutral "No health set"). */
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

/** Props for {@link HealthDot}. */
export interface HealthDotProps {
  /** The health verdict, or `null` when unset (renders nothing). */
  health: Health | null;
}

/**
 * A compact health indicator for a dense list row: a colored dot with its verdict label.
 *
 * @remarks
 * The full {@link HealthPill} (a tinted, ringed pill) is the right weight for a card or a
 * detail panel, but it crowds a row's trailing slot. {@link HealthDot} keeps the same semantic
 * health-token color as a small dot beside a muted label, so a long roster scans by health
 * without the visual heft. Renders `null` when health is unset (an unset verdict needs no row
 * affordance), keeping the trailing slot quiet.
 */
export function HealthDot({ health }: HealthDotProps): JSX.Element | null {
  if (!health) return null;
  return (
    <span className="text-on-surface-variant hidden items-center gap-1.5 text-xs font-medium @md/row:inline-flex">
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', HEALTH_DOT_CLASS[health])} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** The list's status-filter buckets (all lifecycle statuses, plus "all"). */
export type StatusFilter = 'all' | ProjectStatus;

/** Ordered filter options with their labels (drives the menu + the trigger label). */
const FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
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
