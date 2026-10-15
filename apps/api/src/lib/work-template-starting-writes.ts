import type { task } from '@docket/db';
import type { RecordedChange } from '../mcp/change-set';
import { taskUpdateChange } from './provenance/task-change-sets';
import type { TemplateTargetType } from '@docket/work/template-contract';
import { and, eq } from 'drizzle-orm';
import type { ActorCtx } from '../context';
import { NotFoundError } from '../error';
import type { TemplateTransaction } from './templates/persistence';
import type { prepareTemplateChange } from './work-template-change-preview';
import { workTables } from './work-template-selection';
import { resolveContainerStatus, resolveTaskStatus } from './work-status';
import {
  writeTaskStateTransition,
  finishTaskStateTransition,
  applySubtaskCompletionPolicy,
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
} from './task-state';

/** Existing workflow row changes and their post-commit effects, owned by the enclosing assignment receipt. */
export interface StartingStatusWrite {
  readonly changes: readonly RecordedChange[];
  readonly effect: (() => Promise<void>) | null;
}

/** Apply an explicitly reviewed root status through the existing workflow transition helpers. */
export async function applyStartingStatus(
  tx: TemplateTransaction,
  caller: ActorCtx,
  kind: TemplateTargetType,
  before: Parameters<typeof prepareTemplateChange>[2],
  status: unknown,
): Promise<StartingStatusWrite> {
  if (typeof status !== 'string') return { changes: [], effect: null };
  if (kind !== 'task') {
    const transition = await resolveContainerStatus(caller.orgId, kind, status, 'status', tx);
    const table = workTables[kind];
    await tx
      .update(table)
      .set({ status: transition.status, statusId: transition.statusId })
      .where(and(eq(table.id, before.id), eq(table.organizationId, caller.orgId)));
    return { changes: [], effect: null };
  }
  if (!('title' in before)) throw new NotFoundError('Task not found');
  return applyStartingTaskStatus(tx, caller, before, status);
}

async function applyStartingTaskStatus(
  tx: TemplateTransaction,
  caller: ActorCtx,
  before: typeof task.$inferSelect,
  status: string,
): Promise<StartingStatusWrite> {
  const transition = await resolveTaskStatus(caller.orgId, before.teamId, status, 'status', tx);
  const mutation = await writeTaskStateTransition(tx, { before, ...transition });
  if (!mutation) throw new NotFoundError('Task not found');
  const timerStops = await closeCompletingUserTaskTimers(tx, caller.actorId, mutation);
  const cascades = await applySubtaskCompletionPolicy(tx, mutation);
  return {
    changes: [mutation, ...cascades].flatMap((row) => {
      const change = taskUpdateChange(row);
      return change ? [change] : [];
    }),
    effect: async () => {
      await finishTaskStateTransition({ actorId: caller.actorId, enqueueSearch: false }, mutation);
      await emitCompletedTaskTimerStops(timerStops);
      for (const cascade of cascades) await finishTaskStateTransition({ actorId: null }, cascade);
    },
  };
}
