/** Project a person's accepted daily sessions into the shared agenda. */
import { actor, dailyPlanDay, dailyPlanItem, db, hub, task } from '@docket/db';
import type { AgendaOut } from '@docket/planning/agenda-contract';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { buildTaskViewFilter } from './task-helpers';

type AgendaEntry = z.input<typeof AgendaOut>['entries'][number];

async function loadPlanRows(hubId: string, date: string) {
  return db
    .select({
      id: task.id,
      taskId: task.id,
      organizationId: task.organizationId,
      title: task.title,
      state: task.state,
      priority: task.priority,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
      startsAt: dailyPlanItem.timeboxStartsAt,
      endsAt: dailyPlanItem.timeboxEndsAt,
    })
    .from(dailyPlanItem)
    .innerJoin(
      task,
      and(
        eq(task.id, dailyPlanItem.refTaskId),
        eq(task.organizationId, dailyPlanItem.refOrganizationId),
      ),
    )
    .where(
      and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date), isNull(task.archivedAt)),
    );
}

type PlanRow = Awaited<ReturnType<typeof loadPlanRows>>[number];

async function loadTaskFilters(userId: string, rows: readonly PlanRow[]) {
  const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
  if (organizationIds.length === 0)
    return new Map<string, Awaited<ReturnType<typeof buildTaskViewFilter>>>();
  const actors = await db
    .select({ id: actor.id, organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        inArray(actor.organizationId, organizationIds),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  return new Map(
    await Promise.all(
      actors.map(
        async (row) =>
          [row.organizationId, await buildTaskViewFilter(row.organizationId, row.id)] as const,
      ),
    ),
  );
}

function projectEntries(
  rows: readonly PlanRow[],
  accepted: typeof dailyPlanDay.$inferSelect.accepted,
  filters: Awaited<ReturnType<typeof loadTaskFilters>>,
): AgendaEntry[] {
  const snapshot = accepted?.current.snapshot;
  const acceptedTaskIds = new Set(snapshot?.tasks.map((entry) => entry.taskId) ?? []);
  const legacy = rows.flatMap((row) => {
    if (
      acceptedTaskIds.has(row.taskId) ||
      !row.startsAt ||
      !row.endsAt ||
      !filters.get(row.organizationId)?.(row)
    )
      return [];
    return [
      {
        kind: 'task_timebox' as const,
        taskId: row.taskId,
        organizationId: row.organizationId,
        title: row.title,
        state: row.state,
        priority: row.priority,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      },
    ];
  });
  const byId = new Map(rows.map((row) => [row.taskId, row]));
  const sessions = (snapshot?.sessions ?? []).flatMap((session) => {
    const visible = session.allocations.flatMap((allocation) => {
      const row = byId.get(allocation.taskId);
      return row && filters.get(row.organizationId)?.(row) ? [row] : [];
    });
    const first = visible[0];
    if (!first) return [];
    return [
      {
        kind: 'task_timebox' as const,
        sessionId: session.id,
        taskId: first.taskId,
        organizationId: first.organizationId,
        title: visible.map((row) => row.title).join(' · '),
        state: first.state,
        priority: first.priority,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      },
    ];
  });
  return [...legacy, ...sessions];
}

/** Recheck current task access before including personal plan pointers. */
export async function loadPlannedAgendaEntries(
  userId: string,
  date: string,
): Promise<AgendaEntry[]> {
  const [person] = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  if (!person) return [];
  const [rows, acceptedRows] = await Promise.all([
    loadPlanRows(person.id, date),
    db
      .select({ accepted: dailyPlanDay.accepted })
      .from(dailyPlanDay)
      .where(and(eq(dailyPlanDay.hubId, person.id), eq(dailyPlanDay.date, date)))
      .limit(1),
  ]);
  return projectEntries(
    rows,
    acceptedRows[0]?.accepted ?? null,
    await loadTaskFilters(userId, rows),
  );
}
