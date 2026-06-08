/**
 * Status presentation for the Cycles screens.
 *
 * @remarks
 * A {@link import('@docket/types').CycleStatus | cycle status} drives both the list's
 * three segments (Current / Upcoming / Completed) and the badge a cycle carries. The
 * mapping here keeps that presentation in one place: the segment a status belongs to, its
 * human label, and the {@link import('@docket/ui/primitives').Badge | Badge} variant that
 * reads correctly for it — `active` is the live, default-emphasis cadence; `upcoming` and
 * `completed` are quieter, secondary states. All colors come from the badge's semantic
 * variants — never hardcoded.
 */
import type { CycleStatus } from '@docket/types';
import type { WorkflowStateType } from '@docket/ui/components';

/** The three list segments the Cycles list groups cycles into, current-first. */
export const CYCLE_SEGMENTS = ['active', 'upcoming', 'completed'] as const;

/** One of the list's three cycle segments. */
export type CycleSegment = (typeof CYCLE_SEGMENTS)[number];

/** The human heading for each list segment (the cycle noun is applied by the caller). */
export const SEGMENT_LABEL: Record<CycleSegment, string> = {
  active: 'Current',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

/** The human label for each cycle status (used on badges). */
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

/**
 * Map a cycle status to the list segment it belongs to.
 *
 * @remarks
 * The status enum and the segment set are 1:1 today, but routing through this function keeps
 * the list's grouping decoupled from the wire enum so a future status (e.g. a paused cadence)
 * can be folded into a segment without touching the list.
 *
 * @param status - The cycle's status.
 * @returns the segment the cycle is shown under.
 */
export function segmentOf(status: CycleStatus): CycleSegment {
  switch (status) {
    case 'active':
      return 'active';
    case 'upcoming':
      return 'upcoming';
    case 'completed':
      return 'completed';
  }
}
