import { db } from '@docket/db';

import { advanceCompletedProcessTask } from '../lib/recurrence/advance';
import {
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
  finishTaskStateTransition,
  type CompletedTaskTimerStop,
  type TaskStateMutation,
} from '../lib/task-state';
import { enqueueSearchUpsert } from '../search/write-through';

import type { resolveStateTransition, TaskRow } from './task-helpers';

type TaskTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function closePatchTimers(
  tx: TaskTransaction,
  actorId: string,
  statePatch: Awaited<ReturnType<typeof resolveStateTransition>> | undefined,
  before: TaskRow,
  after: TaskRow,
): Promise<CompletedTaskTimerStop[]> {
  if (statePatch === undefined) return [];
  return closeCompletingUserTaskTimers(tx, actorId, { before, after });
}

export async function finishTaskPatch(input: {
  readonly orgId: string;
  readonly actorId: string;
  readonly row: TaskRow;
  readonly completedAt: Date | null | undefined;
  readonly timerStops: readonly CompletedTaskTimerStop[];
  readonly cascades: readonly TaskStateMutation[];
}): Promise<void> {
  await enqueueSearchUpsert(input.orgId, 'task', input.row.id);
  await emitCompletedTaskTimerStops(input.timerStops);
  if (input.completedAt) {
    await advanceCompletedProcessTask(db, {
      organizationId: input.orgId,
      actorId: input.actorId,
      completedTaskId: input.row.id,
      completedOn: input.completedAt.toISOString().slice(0, 10),
    });
  }
  for (const cascade of input.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
}
