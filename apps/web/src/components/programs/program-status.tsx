'use client';

/**
 * Program status presentation — the lifecycle badge and the health indicators for the Programs
 * list and detail.
 *
 * @remarks
 * Programs are *ongoing* operations, so their lifecycle is `active | paused | archived`
 * (there is intentionally no `completed` — see {@link ProgramStatus}). `active` reads as the
 * default emphasis; `paused`/`archived` read as muted/quiet so a long roster scans by
 * weight. The roster's filter / group / sort affordances are now the unified
 * {@link import('@/components/views/filter-toolbar').FilterToolbar} (driven by
 * {@link import('./program-catalog').buildProgramCatalog}), so this module no longer ships its
 * own bespoke status menu — only the presentation helpers a row + detail render with.
 */
import type { Health, ProgramStatus } from '@docket/types';
import type { WorkflowStateType } from '@docket/ui/components';
import { cn } from '@docket/ui';
import { Badge } from '@docket/ui/primitives';
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

/**
 * The canonical workflow-state type each Program lifecycle status reads as, for the leading
 * {@link import('@docket/ui/components').StatusIcon | StatusIcon} glyph on a list row.
 *
 * @remarks
 * Programs are *ongoing*, so the glyph signals liveness rather than completion: `active` is
 * the in-progress dot, `paused` a quiet unstarted ring, and `archived` the cancel mark.
 */
export function statusGlyphType(status: ProgramStatus): WorkflowStateType {
  switch (status) {
    case 'active':
      return 'started';
    case 'paused':
      return 'unstarted';
    case 'archived':
      return 'canceled';
  }
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

/** Props for {@link HealthDot}. */
export interface HealthDotProps {
  /** The health verdict, or `null` when unset (renders nothing). */
  health: Health | null;
}

/**
 * A compact health indicator for a dense list row: a colored dot with its verdict label.
 *
 * @remarks
 * The full {@link HealthPill} is the right weight for a detail panel; on a dense row a small
 * dot + muted label keeps the same semantic health-token color without crowding the trailing
 * slot. Renders `null` when health is unset.
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
