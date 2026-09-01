/**
 * Status presentation for the Cycles screens.
 *
 * @remarks
 * Cycle status is the one status in the product a workspace does not define, and deliberately so:
 * a cycle's status follows its dates. A cadence that has not begun is upcoming, the one containing
 * today is active, and one whose window has passed is completed — there is no stage anyone could
 * usefully rename, because naming one would not change when a cycle rolls.
 *
 * So the three statuses stay declared here, in the same
 * {@link import('@/components/entity-display/work-status').WorkStatusDisplay} shape everything
 * else now reads. That shape is what lets a cycle row render through the same badge and glyph as a
 * project or a task, without a second mapping table for a set of three.
 */
import type { CycleStatus } from '@docket/work/cycle-contract';

import type { WorkStatusDisplay } from '@/components/entity-display/work-status';

/**
 * What each cycle status is called and how it behaves.
 *
 * @remarks
 * `active` is the live cadence and therefore the one a roster should pick out; `upcoming` has not
 * begun and `completed` is behind us, which is exactly what the `started` / `unstarted` /
 * `completed` categories already say, so the badge emphasis and the glyph both fall out of them.
 */
export const CYCLE_STATUS: Record<CycleStatus, WorkStatusDisplay> = {
  active: { key: 'active', name: 'Active', category: 'started' },
  upcoming: { key: 'upcoming', name: 'Upcoming', category: 'unstarted' },
  completed: { key: 'completed', name: 'Completed', category: 'completed' },
};

/**
 * The cycle statuses in cadence-lifecycle order.
 *
 * @remarks
 * Live first, because the cycle a team is in is the one it is asking about; the roster's default
 * status grouping reads this order top-to-bottom.
 */
export const CYCLE_STATUS_ORDER: readonly WorkStatusDisplay[] = [
  CYCLE_STATUS.active,
  CYCLE_STATUS.upcoming,
  CYCLE_STATUS.completed,
];
