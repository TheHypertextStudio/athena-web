import { CycleId } from '@docket/work/ids';

import type { TaskPatch } from './use-task-mutations';
import { UserFacingError } from './problem';

/** Build the cycle fields sent by a task patch. */
export function cycleAssignmentRequest(patch: TaskPatch): {
  readonly cycleId?: ReturnType<typeof CycleId.parse> | null;
  readonly cycleCadenceRevision?: number;
} {
  return {
    ...(patch.cycleId === undefined
      ? {}
      : { cycleId: patch.cycleId === null ? null : CycleId.parse(patch.cycleId) }),
    ...(patch.cycleCadenceRevision === undefined
      ? {}
      : { cycleCadenceRevision: patch.cycleCadenceRevision }),
  };
}

/** Whether a failed cycle move used a cadence revision that is no longer current. */
export function isCycleCadenceConflict(error: unknown, patch: TaskPatch): boolean {
  return (
    patch.cycleId !== undefined &&
    error instanceof UserFacingError &&
    error.code === 'cadence_changed'
  );
}
