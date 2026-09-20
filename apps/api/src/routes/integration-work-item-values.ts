import type { WorkStatusCategory } from '@docket/work/work-status-contract';
import type { ExternalWorkItem, ExternalCycle, ExternalProject } from '@docket/integrations';

/** Parse an optional provider date. */
export function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** The task-completion/cancel timestamps a pulled item implies (explicit stamp, else the anchor). */
export function lifecycleStamps(
  item: ExternalWorkItem,
  anchor: Date,
): { completedAt: Date | null; canceledAt: Date | null } {
  const completedAt = toDate(item.completedAt) ?? (item.stateType === 'completed' ? anchor : null);
  const canceledAt = toDate(item.canceledAt) ?? (item.stateType === 'canceled' ? anchor : null);
  return { completedAt, canceledAt };
}

/** Map provider project state to a workspace status category. */
export function mapProjectCategory(state: ExternalProject['state']): WorkStatusCategory {
  switch (state) {
    case 'backlog':
      return 'backlog';
    case 'planned':
    case 'paused':
      return 'unstarted';
    case 'started':
      return 'started';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
  }
}

/**
 * Derive a Docket {@link cycleStatus} from an external cycle's dates.
 *
 * @remarks
 * The `cycle` table has no external status field to mirror — its model is date-driven — so we
 * classify from `completedAt`/`startsAt`/`endsAt` against the reconcile clock: an explicit
 * `completedAt` (or a window fully in the past) is `completed`, a window not yet begun is
 * `upcoming`, and an in-flight window is `active`.
 */
export function deriveCycleStatus(
  external: ExternalCycle,
  now: Date,
): 'upcoming' | 'active' | 'completed' {
  if (external.completedAt) return 'completed';
  const startsMs = Date.parse(external.startsAt);
  const endsMs = Date.parse(external.endsAt);
  const nowMs = now.getTime();
  if (nowMs < startsMs) return 'upcoming';
  if (nowMs >= endsMs) return 'completed';
  return 'active';
}
