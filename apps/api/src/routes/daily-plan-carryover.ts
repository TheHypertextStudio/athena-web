/** Viewable unfinished work from earlier daily commitments. */
import { dailyPlanItem, dailyPlanReview, db, task } from '@docket/db';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';

import { resolveResourceAccess, resourceAccessKey } from '../permissions/resource-access';

/** Keep the most recent older commitment for each unfinished task. */
export async function loadUnfinishedPriorWork(userId: string, hubId: string, date: string) {
  const rows = await db
    .select({
      taskId: task.id,
      planItemId: dailyPlanItem.id,
      organizationId: task.organizationId,
      title: task.title,
      plannedDate: dailyPlanItem.date,
    })
    .from(dailyPlanItem)
    .innerJoin(
      task,
      and(
        eq(task.id, dailyPlanItem.refTaskId),
        eq(task.organizationId, dailyPlanItem.refOrganizationId),
      ),
    )
    .leftJoin(dailyPlanReview, eq(dailyPlanReview.sourceItemId, dailyPlanItem.id))
    .where(
      and(
        eq(dailyPlanItem.hubId, hubId),
        lt(dailyPlanItem.date, date),
        eq(dailyPlanItem.status, 'planned'),
        isNull(task.completedAt),
        isNull(task.archivedAt),
        isNull(dailyPlanReview.id),
      ),
    )
    .orderBy(desc(dailyPlanItem.date))
    .limit(100);
  const latest = [...new Map(rows.reverse().map((row) => [row.taskId, row])).values()];
  const access = await resolveResourceAccess(
    userId,
    latest.map((row) => ({
      id: row.taskId,
      organizationId: row.organizationId,
      kind: 'task' as const,
    })),
  );
  return latest.filter(
    (row) =>
      access.get(
        resourceAccessKey({
          id: row.taskId,
          organizationId: row.organizationId,
          kind: 'task',
        }),
      )?.canView,
  );
}
