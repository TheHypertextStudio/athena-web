import type * as DbModule from '@docket/db';
import {
  remainingDailyTaskIds,
  type DailyExecutionActual,
} from '@docket/planning/daily-plan-execution';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';
import type dailyPlanRouter from '../../src/routes/daily-plan';
let schema: typeof DbModule;
let router: typeof dailyPlanRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/daily-plan')).default;
});

async function recordedWork(open: boolean) {
  const userId = await seedUserWithHub(schema.db, schema, 'MidnightActual');
  const [hub] = await schema.db.select().from(schema.hub).where(eq(schema.hub.userId, userId));
  if (!hub) throw new Error('Missing seeded hub');
  const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
  const statusId = await seedStatuses(schema.db, schema, orgId);
  const [task] = await schema.db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      teamId,
      title: 'Cross-midnight work',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
    })
    .returning();
  if (!task) throw new Error('Missing seeded task');
  const startedAt = new Date('2027-01-04T23:30:00.000Z');
  const endedAt = open ? null : new Date('2027-01-05T00:15:00.000Z');
  const [record] = await schema.db
    .insert(schema.timeRecord)
    .values({
      hubId: hub.id,
      createdByUserId: userId,
      taskId: task.id,
      title: task.title,
      status: open ? 'open' : 'closed',
      startedAt,
      endedAt,
    })
    .returning();
  if (!record) throw new Error('Missing seeded record');
  const [interval] = await schema.db
    .insert(schema.timeInterval)
    .values({
      timeRecordId: record.id,
      hubId: hub.id,
      taskId: task.id,
      userId,
      actorKind: 'human',
      mode: 'human_active',
      source: 'user_timer',
      startedAt,
      endedAt,
    })
    .returning();
  if (!interval) throw new Error('Missing seeded interval');
  return {
    app: appWithSession(router, fakeSession(userId)),
    taskId: task.id,
    intervalId: interval.id,
  };
}

describe('daily actual read boundaries', () => {
  it.each([false, true])(
    'clips midnight work for execution without editing an open=%s ledger row',
    async (open) => {
      const { app, taskId, intervalId } = await recordedWork(open);
      const now = Date.parse('2027-01-05T00:15:00.000Z');
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const response = await app.request('/day/2027-01-05');
        expect(response.status).toBe(200);
        const body = (await response.json()) as { actual: DailyExecutionActual[] };
        expect(body.actual).toEqual([
          {
            taskId,
            startedAt: '2027-01-05T00:00:00.000Z',
            endedAt: open ? null : '2027-01-05T00:15:00.000Z',
            recordedMinutes: 15,
          },
        ]);
        expect(
          remainingDailyTaskIds({
            sessions: [],
            actionableTaskIds: [taskId],
            now,
            taskBudgets: [{ taskId, plannedMinutes: 30 }],
            actual: body.actual,
          }),
        ).toEqual([taskId]);
        const previous = (await (await app.request('/day/2027-01-04')).json()) as {
          actual: DailyExecutionActual[];
        };
        expect(previous.actual).toEqual([
          {
            taskId,
            startedAt: '2027-01-04T23:30:00.000Z',
            endedAt: '2027-01-05T00:00:00.000Z',
            recordedMinutes: 30,
          },
        ]);
        const [ledger] = await schema.db
          .select()
          .from(schema.timeInterval)
          .where(eq(schema.timeInterval.id, intervalId));
        expect(ledger?.startedAt.toISOString()).toBe('2027-01-04T23:30:00.000Z');
        expect(ledger?.endedAt?.toISOString() ?? null).toBe(
          open ? null : '2027-01-05T00:15:00.000Z',
        );
      } finally {
        clock.mockRestore();
      }
    },
  );
});
