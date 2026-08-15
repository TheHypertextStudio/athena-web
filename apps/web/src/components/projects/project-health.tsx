'use client';

/**
 * Project health presentation — the pill and the dense-row dot for the Projects list and detail.
 *
 * @remarks
 * Health is a *judgment* a person records ("is this going to land?"), which is a different question
 * from the lifecycle status beside it, and it stays a closed three-value verdict while status is
 * now whatever the workspace decided to call its stages. So the two parted ways: status renders
 * through {@link import('@/components/entity-display/work-status').WorkStatusBadge}, and this
 * module keeps only the health atoms.
 *
 * Both atoms draw from the same semantic tokens in {@link import('./health')}, so a project reads
 * the same colour for "at risk" in a detail panel as in a dense roster row.
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
