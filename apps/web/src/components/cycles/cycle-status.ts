/**
 * Status presentation for the Cycles screens.
 *
 * @remarks
 * A {@link import('@docket/types').CycleStatus | cycle status} drives both the unified
 * filter toolbar's status grouping and the badge a cycle carries. The mapping here keeps
 * that presentation in one place: its human label, the leading {@link
 * import('@docket/ui/components').StatusIcon | StatusIcon} glyph, and the {@link
 * import('@docket/ui/primitives').Badge | Badge} variant that reads correctly for it —
 * `active` is the live, default-emphasis cadence; `upcoming` and `completed` are quieter,
 * secondary states. All colors come from the badge's semantic variants — never hardcoded.
 */
import type { CycleStatus } from '@docket/types';
import type { WorkflowStateType } from '@docket/ui/components';

/** The human label for each cycle status (used on badges + group headers). */
export const STATUS_LABEL: Record<CycleStatus, string> = {
  active: 'Active',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

/**
 * The {@link import('@docket/ui/primitives').Badge | Badge} variant for a cycle status.
 *
 * @remarks
 * The live `active` cadence gets the default (filled) emphasis so it stands out in a list of
 * many cycles; `upcoming` and `completed` are quiet, secondary states.
 *
 * @param status - The cycle's status.
 * @returns the badge variant to render.
 */
export function statusBadgeVariant(status: CycleStatus): 'default' | 'secondary' {
  return status === 'active' ? 'default' : 'secondary';
}

/**
 * The canonical workflow-state type a cycle status reads as, for the leading
 * {@link import('@docket/ui/components').StatusIcon | StatusIcon} glyph on a list row.
 *
 * @remarks
 * The live `active` cadence shows the in-progress dot, an `upcoming` (not-yet-started) cadence
 * a plain unstarted ring, and a `completed` cadence the completed check — the same glyph
 * vocabulary a task carries, so a cycle row reads as one of the family.
 */
export function statusGlyphType(status: CycleStatus): WorkflowStateType {
  switch (status) {
    case 'active':
      return 'started';
    case 'upcoming':
      return 'unstarted';
    case 'completed':
      return 'completed';
  }
}
