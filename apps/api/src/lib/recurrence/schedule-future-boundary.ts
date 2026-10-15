import { ConflictError } from '../../error';
import { scheduleCivilToday } from './schedule-review-date';

/** Saved revision facts required before authoring or reviewing future-only schedule changes. */
export interface FutureScheduleBoundary {
  readonly status: 'active' | 'paused' | 'ended';
  readonly latestEffectiveFrom: string;
  readonly effectiveFrom: string;
  readonly timezone: string;
}
/** Preserve monotonic revisions and historical work even when callers bypass the browser editor. */
export function requireFutureScheduleBoundary(
  input: FutureScheduleBoundary,
  now = new Date(),
): void {
  if (input.status === 'ended')
    throw new ConflictError('Ended schedules cannot have future revisions');
  if (input.effectiveFrom < scheduleCivilToday(input.timezone, now))
    throw new ConflictError('Future schedule changes cannot begin in the past');
  if (input.effectiveFrom <= input.latestEffectiveFrom)
    throw new ConflictError('Future schedule changes must follow the latest schedule version');
}
