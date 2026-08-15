'use client';

/**
 * Program health presentation — the pill and the dense-row dot for the Programs list and detail.
 *
 * @remarks
 * The Programs counterpart to
 * {@link import('@/components/projects/project-health')}, and it split from the lifecycle status
 * for the same reason: health is a closed three-value judgment, while a program's status is now
 * whatever the workspace named its stages, rendered through
 * {@link import('@/components/entity-display/work-status').WorkStatusBadge}.
 */
import type { Health } from '@docket/types';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import { HEALTH_DOT_CLASS, HEALTH_LABEL, HEALTH_PILL_CLASS } from './health';

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
