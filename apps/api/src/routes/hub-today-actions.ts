import { satisfies } from '@docket/authz';
import { actor, dailyPlanItem, db, hub, role, task, team } from '@docket/db';
import type { HubTodayCompleteOut } from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { CapabilityError, ConflictError, NotFoundError } from '../error';
import {
  applySubtaskCompletionPolicy,
  finishTaskStateTransition,
  writeTaskStateTransition,
} from '../lib/task-state';
import { resolveResourceAccess, resourceAccessKey } from '../permissions/resource-access';
import { toTaskItem } from './hub-helpers';
import { loadStatusSets } from '../lib/work-status';

/**
 * Complete one caller-owned Today row and its Task workflow in one transaction.
 *
 * @param userId - The authenticated Hub owner.
 * @param planItemId - The personal daily-plan row to complete.
 * @returns The semantically completed Task and plan result.
 */
export async function completeTodayItem(
  userId: string,
  planItemId: string,
): Promise<z.input<typeof HubTodayCompleteOut>> {
  const ownedRows = await db
    .select({
      hubId: hub.id,
      organizationId: dailyPlanItem.refOrganizationId,
      taskId: dailyPlanItem.refTaskId,
    })
    .from(hub)
    .innerJoin(dailyPlanItem, eq(dailyPlanItem.hubId, hub.id))
    .where(and(eq(hub.userId, userId), eq(dailyPlanItem.id, planItemId)))
    .limit(1);
  const owned = ownedRows[0];
  if (!owned) throw new NotFoundError('Today item not found');

  const ref = { organizationId: owned.organizationId, kind: 'task', id: owned.taskId } as const;
  const [access, membershipRows] = await Promise.all([
    resolveResourceAccess(userId, [ref]),
    db
      .select({ actor, role })
      .from(actor)
      .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, owned.organizationId)))
      .where(
        and(
          eq(actor.userId, userId),
          eq(actor.organizationId, owned.organizationId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
        ),
      )
      .limit(1),
  ]);
  const membership = membershipRows[0];
  if (access.get(resourceAccessKey(ref))?.canView !== true || !membership) {
    throw new NotFoundError('Today item not found');
  }
  const capabilities = membership.role?.capabilities ?? [];
  if (!capabilities.some((capability) => satisfies(capability, 'contribute'))) {
    throw new CapabilityError();
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ plan: dailyPlanItem, work: task })
      .from(dailyPlanItem)
      .innerJoin(task, eq(task.id, dailyPlanItem.refTaskId))
      .innerJoin(team, eq(team.id, task.teamId))
      .where(
        and(
          eq(dailyPlanItem.id, planItemId),
          eq(dailyPlanItem.hubId, owned.hubId),
          eq(task.organizationId, dailyPlanItem.refOrganizationId),
          isNull(task.archivedAt),
          isNull(task.completedAt),
          isNull(task.canceledAt),
        ),
      )
      .limit(1)
      .for('update');
    const row = rows[0];
    if (!row) throw new NotFoundError('Today item not found');
    // Resolved against the task's own team, because a team that keeps its own statuses completes
    // work into its own Done rather than the workspace's.
    const sets = await loadStatusSets(
      ref.organizationId,
      { entityTypes: ['task'], teamIds: [row.work.teamId] },
      // Read through the open transaction: the module-level client would stall on a connection
      // this transaction already holds.
      tx,
    );
    const completedState = sets.firstOfCategory('task', 'completed', row.work.teamId);
    /* v8 ignore next -- @preserve every set is required to keep a way to finish */
    if (!completedState) throw new ConflictError('This workspace has no completed status');

    const now = new Date();
    const mutation = await writeTaskStateTransition(tx, {
      before: row.work,
      statusId: completedState.id,
      state: completedState.key,
      completedAt: now,
      canceledAt: null,
    });
    if (!mutation) throw new NotFoundError('Today item not found');
    await tx
      .update(dailyPlanItem)
      .set({ status: 'done' })
      .where(and(eq(dailyPlanItem.id, row.plan.id), eq(dailyPlanItem.hubId, owned.hubId)));
    return {
      mutation,
      cascades: await applySubtaskCompletionPolicy(tx, mutation),
      completedCategory: completedState.category,
    };
  });

  await finishTaskStateTransition({ actorId: membership.actor.id }, result.mutation);
  for (const cascade of result.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }

  return {
    task: toTaskItem(result.mutation.after, result.completedCategory),
    planItemId,
    planStatus: 'done',
  };
}
