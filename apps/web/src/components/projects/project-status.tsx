'use client';

/**
 * Project status presentation — the lifecycle badge and the health pill/dot for the Projects
 * list and detail.
 *
 * @remarks
 * A Project is a *bounded* effort, so its lifecycle is `planned | active | completed |
 * canceled` ({@link ProjectStatus}). `active` reads as the default emphasis; the other
 * statuses read as muted/quiet so a long roster scans by weight.
 *
 * Filtering the roster is no longer a bespoke control here: the Projects list adopts the unified
 * {@link import('@/components/views/filter-toolbar').FilterToolbar} over the project
 * {@link import('./project-catalog').buildProjectCatalog | catalog}, so this module owns only the
 * presentation atoms (badge, health pill/dot) and the status→glyph/label mappings that catalog
 * reuses.
 */
import type { Health, ProjectStatus } from '@docket/types';
import type { WorkflowStateType } from '@docket/ui/components';
import { cn } from '@docket/ui';
import { Badge } from '@docket/ui/primitives';
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
