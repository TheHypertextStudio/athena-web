import { dailyPlanDay, dailyPlanItem, db } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { dailyAllocations } from '@docket/planning/daily-plan-execution';
import { and, eq } from 'drizzle-orm';

import type { WorkloadInterval } from './intervals';
import { assertWorkloadBounded, MAX_WORKLOAD_ROWS } from './limits';

/** Selected work with canonical accepted allocations, or legacy timeboxes before acceptance. */
export interface WorkloadPlanTask {
  readonly completed: boolean;
  readonly boxes: WorkloadInterval[];
}

function legacyPlanTasks(
  items: readonly (typeof dailyPlanItem.$inferSelect)[],
): Map<string, WorkloadPlanTask> {
  const tasks = new Map<string, WorkloadPlanTask>();
  for (const item of items) {
    const previous = tasks.get(item.refTaskId);
    tasks.set(item.refTaskId, {
      completed: Boolean(previous?.completed) || item.status === 'done',
      boxes: [
        ...(previous?.boxes ?? []),
        ...(item.timeboxStartsAt && item.timeboxEndsAt
          ? [{ start: item.timeboxStartsAt.getTime(), end: item.timeboxEndsAt.getTime() }]
          : []),
      ],
    });
  }
  return tasks;
}

function applyAcceptedAllocations(
  tasks: Map<string, WorkloadPlanTask>,
  snapshot: DailyPlanSnapshot,
  organizationId: string,
): void {
  assertWorkloadBounded(snapshot.tasks.length);
  assertWorkloadBounded(snapshot.sessions.length);
  assertWorkloadBounded(
    snapshot.sessions.reduce((total, session) => total + session.allocations.length, 0),
  );
  const selected = new Set(
    snapshot.tasks
      .filter((task) => task.organizationId === organizationId)
      .map((task) => task.taskId),
  );
  for (const id of selected)
    tasks.set(id, { completed: tasks.get(id)?.completed ?? false, boxes: [] });
  assertWorkloadBounded(tasks.size);
  for (const allocation of dailyAllocations(snapshot.sessions)) {
    if (!selected.has(allocation.taskId)) continue;
    tasks.get(allocation.taskId)?.boxes.push({
      start: Date.parse(allocation.startsAt),
      end: Date.parse(allocation.endsAt),
    });
  }
}

/** Read personal intent without substituting the lossy first-session compatibility projection. */
export async function loadWorkloadPlans(query: {
  readonly hubId: string;
  readonly orgId: string;
  readonly date: string;
}): Promise<ReadonlyMap<string, WorkloadPlanTask>> {
  const [items, days] = await Promise.all([
    db
      .select()
      .from(dailyPlanItem)
      .where(
        and(
          eq(dailyPlanItem.hubId, query.hubId),
          eq(dailyPlanItem.refOrganizationId, query.orgId),
          eq(dailyPlanItem.date, query.date),
        ),
      )
      .limit(MAX_WORKLOAD_ROWS + 1),
    db
      .select({ accepted: dailyPlanDay.accepted })
      .from(dailyPlanDay)
      .where(and(eq(dailyPlanDay.hubId, query.hubId), eq(dailyPlanDay.date, query.date)))
      .limit(1),
  ]);
  assertWorkloadBounded(items.length);
  const tasks = legacyPlanTasks(items);
  const snapshot = days[0]?.accepted?.current.snapshot;
  if (snapshot) applyAcceptedAllocations(tasks, snapshot, query.orgId);
  return tasks;
}
