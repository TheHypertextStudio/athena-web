import {
  agentSession,
  dailyPlanItem,
  db,
  hub,
  notification,
  task,
  taskDependency,
} from '@docket/db';
import type { HubTaskItem } from '@docket/types';
import type { HubTodayOut } from '@docket/types';
import { and, count, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { z } from 'zod';

import { callerActorIds, callerOrgIds, sameDay, toTaskItem } from './hub-helpers';

/**
 * Select the caller's tasks blocked by at least one incomplete blocking task.
 *
 * @param orgIds - The caller's in-scope org ids.
 * @param actorIds - The caller's active human actor ids.
 */
async function selectBlockedTasks(
  orgIds: string[],
  actorIds: string[],
): Promise<z.input<typeof HubTaskItem>[]> {
  const mine = await db
    .select()
    .from(task)
    .where(and(inArray(task.organizationId, orgIds), inArray(task.assigneeId, actorIds)));
  if (mine.length === 0) return [];

  const blockedIds = mine.map((t) => t.id);
  const edges = await db
    .select({
      blockedTaskId: taskDependency.blockedTaskId,
      blockingCompletedAt: task.completedAt,
    })
    .from(taskDependency)
    .innerJoin(task, eq(task.id, taskDependency.blockingTaskId))
    .where(inArray(taskDependency.blockedTaskId, blockedIds));

  const blockedSet = new Set(
    edges.filter((e) => e.blockingCompletedAt === null).map((e) => e.blockedTaskId),
  );
  return mine.filter((t) => blockedSet.has(t.id)).map(toTaskItem);
}

/**
 * Build the hub today payload (without the HTTP envelope).
 * The route handler calls `ok(c, HubTodayOut, ...)` inline to preserve Hono's RPC types.
 */
export async function buildHubTodayPayload(
  userId: string,
  date: string,
): Promise<z.input<typeof HubTodayOut>> {
  const orgIds = await callerOrgIds(userId);
  if (orgIds.length === 0) {
    return {
      date,
      plan: [],
      calendar: [],
      needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
    };
  }

  const hubRows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const hubId = hubRows[0]?.id;
  const planRows = hubId
    ? await db
        .select()
        .from(dailyPlanItem)
        .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)))
    : [];

  const inScopePlanRows = planRows.filter((r) => orgIds.includes(r.refOrganizationId));
  const plannedTaskIds = inScopePlanRows.map((r) => r.refTaskId);

  const planned =
    plannedTaskIds.length > 0
      ? await db
          .select()
          .from(task)
          .where(and(inArray(task.organizationId, orgIds), inArray(task.id, plannedTaskIds)))
      : [];

  const dueRows =
    plannedTaskIds.length > 0
      ? await db
          .select()
          .from(task)
          .where(
            and(
              inArray(task.organizationId, orgIds),
              eq(task.dueDate, new Date(date)),
              notInArray(task.id, plannedTaskIds),
            ),
          )
      : await db
          .select()
          .from(task)
          .where(and(inArray(task.organizationId, orgIds), eq(task.dueDate, new Date(date))));

  const plan = [...planned, ...dueRows].map(toTaskItem);

  const calendar = inScopePlanRows.flatMap((r) => {
    const startsAt = r.timeboxStartsAt;
    const endsAt = r.timeboxEndsAt;
    if (!startsAt || !endsAt) return [];
    return [
      {
        taskId: r.refTaskId,
        organizationId: r.refOrganizationId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    ];
  });

  const dueToday = [
    ...planned.filter((t) => sameDay(t.dueDate?.toISOString() ?? null, date)),
    ...dueRows,
  ].map(toTaskItem);

  const awaitingSessions = await db
    .select({ taskId: agentSession.taskId })
    .from(agentSession)
    .where(
      and(
        inArray(agentSession.organizationId, orgIds),
        eq(agentSession.status, 'awaiting_approval'),
      ),
    );
  const approvalTaskIds = [
    ...new Set(awaitingSessions.map((s) => s.taskId).filter((id): id is string => id !== null)),
  ];
  const approvals =
    approvalTaskIds.length > 0
      ? (
          await db
            .select()
            .from(task)
            .where(and(inArray(task.organizationId, orgIds), inArray(task.id, approvalTaskIds)))
        ).map(toTaskItem)
      : [];

  const myActorIds = await callerActorIds(userId);
  const blocked = myActorIds.length > 0 ? await selectBlockedTasks(orgIds, myActorIds) : [];

  const inboxCountRows = await db
    .select({ n: count() })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
  const inbox = inboxCountRows[0]?.n ?? 0;

  return { date, plan, calendar, needsAttention: { approvals, blocked, dueToday, inbox } };
}
