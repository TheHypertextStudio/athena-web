/** Read contract and visible data for one planning day. */
import { dailyPlanItem, db, hub, task } from '@docket/db';
import type { dailyPlanDay } from '@docket/db';
import { AgendaOut } from '@docket/planning/agenda-contract';
import { AcceptedDailyPlan, DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { addDays, instantAt } from '@docket/planning/zoned-time';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { resolveResourceAccess, resourceAccessKey } from '../permissions/resource-access';
import { loadSchedulingPreferences } from '../services/scheduling/repository';
import { buildAgendaPayload } from './calendar-shared';
import { loadUnfinishedPriorWork } from './daily-plan-carryover';
import { loadRecordedDayWork } from './daily-plan-work';

/** Date parameter shared by day read and write routes. */
export const dayParam = z.object({ date: z.iso.date() });
const resumeStep = z.enum(['review_yesterday', 'plan_today', 'review_plan']);
/** Input for a resumable daily draft. */
export const draftInput = z.object({ draft: DailyPlanSnapshot, resumeStep });
/** Saved draft and accepted-history response. */
export const dayOut = z.object({
  date: z.iso.date(),
  draft: DailyPlanSnapshot.nullable(),
  accepted: AcceptedDailyPlan.nullable(),
  resumeStep,
});
/** One planning day with visible work, events, and recorded intervals. */
export const dayReadOut = dayOut.extend({
  timezone: z.string(),
  tasks: z.array(
    z.object({
      taskId: z.string(),
      planItemId: z.string().nullable(),
      organizationId: z.string(),
      title: z.string(),
      state: z.string(),
      projectId: z.string().nullable(),
      completedAt: z.iso.datetime().nullable(),
    }),
  ),
  carryover: z.array(
    z.object({
      taskId: z.string(),
      planItemId: z.string(),
      organizationId: z.string(),
      title: z.string(),
      plannedDate: z.iso.date(),
    }),
  ),
  agenda: AgendaOut,
  actual: z.array(
    z.object({
      taskId: z.string().nullable(),
      startedAt: z.iso.datetime(),
      endedAt: z.iso.datetime().nullable(),
      recordedMinutes: z.number().nonnegative(),
    }),
  ),
});

/** Serialize a saved day row without mutating its accepted history. */
export function toDayOut(
  date: string,
  row: typeof dailyPlanDay.$inferSelect | undefined,
): z.input<typeof dayOut> {
  return {
    date,
    draft: row?.draft ?? null,
    accepted: row?.accepted ?? null,
    resumeStep: resumeStep.parse(row?.resumeStep ?? 'review_yesterday'),
  };
}

async function loadVisibleDayTasks(
  userId: string,
  date: string,
  hubId: string,
  row: typeof dailyPlanDay.$inferSelect | undefined,
): Promise<z.input<typeof dayReadOut>['tasks']> {
  const snapshots = [row?.draft, row?.accepted?.current.snapshot].filter(
    (value) => value !== null && value !== undefined,
  );
  const legacyItems = await db
    .select()
    .from(dailyPlanItem)
    .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)));
  const refs =
    snapshots.length > 0
      ? [
          ...new Map(
            snapshots
              .flatMap((snapshot) => snapshot.tasks)
              .map((entry) => [
                entry.taskId,
                {
                  id: entry.taskId,
                  organizationId: entry.organizationId,
                  kind: 'task' as const,
                },
              ]),
          ).values(),
        ]
      : legacyItems
          .sort((left, right) => left.sort - right.sort)
          .map((entry) => ({
            id: entry.refTaskId,
            organizationId: entry.refOrganizationId,
            kind: 'task' as const,
          }));
  const access = await resolveResourceAccess(userId, refs);
  const visibleRefs = refs.filter((ref) => access.get(resourceAccessKey(ref))?.canView);
  if (visibleRefs.length === 0) return [];
  const taskRows = await db
    .select({
      taskId: task.id,
      organizationId: task.organizationId,
      title: task.title,
      state: task.state,
      projectId: task.projectId,
      completedAt: task.completedAt,
    })
    .from(task)
    .where(
      and(
        inArray(
          task.id,
          visibleRefs.map((ref) => ref.id),
        ),
        isNull(task.archivedAt),
      ),
    );
  const visibleKeys = new Set(visibleRefs.map((ref) => `${ref.organizationId}:${ref.id}`));
  const planItemIds = new Map(legacyItems.map((item) => [item.refTaskId, item.id]));
  const order = new Map(refs.map((ref, index) => [`${ref.organizationId}:${ref.id}`, index]));
  return taskRows
    .filter((entry) => visibleKeys.has(`${entry.organizationId}:${entry.taskId}`))
    .sort(
      (left, right) =>
        (order.get(`${left.organizationId}:${left.taskId}`) ?? 0) -
        (order.get(`${right.organizationId}:${right.taskId}`) ?? 0),
    )
    .map((entry) => ({
      ...entry,
      planItemId: planItemIds.get(entry.taskId) ?? null,
      completedAt: entry.completedAt?.toISOString() ?? null,
    }));
}

/** Combine the saved plan, visible work, events, and actual time for one day. */
export async function buildDayRead(
  userId: string,
  hubId: string,
  date: string,
  row: typeof dailyPlanDay.$inferSelect | undefined,
): Promise<z.input<typeof dayReadOut>> {
  const preferences = await loadSchedulingPreferences(db, hubId);
  const [hubRow] = await db
    .select({ preferences: hub.preferences })
    .from(hub)
    .where(eq(hub.id, hubId))
    .limit(1);
  const timezone = hubRow?.preferences.timezone ?? preferences.timezone;
  const dayStart = instantAt(date, 0, timezone);
  const dayEnd = instantAt(addDays(date, 1), 0, timezone);
  const [tasks, agenda, actual, carryover] = await Promise.all([
    loadVisibleDayTasks(userId, date, hubId, row),
    buildAgendaPayload(userId, { date, dayStart, dayEnd }),
    loadRecordedDayWork(hubId, dayStart, dayEnd),
    loadUnfinishedPriorWork(userId, hubId, date),
  ]);
  return { ...toDayOut(date, row), timezone, tasks, agenda, actual, carryover };
}
