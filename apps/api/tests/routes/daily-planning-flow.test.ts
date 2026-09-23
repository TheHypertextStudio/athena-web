import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type dailyPlanRouter from '../../src/routes/daily-plan';
import type dailyPlanReviewRouter from '../../src/routes/daily-plan-review';
import {
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
let dailyPlan: typeof dailyPlanRouter;
let dailyReview: typeof dailyPlanReviewRouter;

beforeAll(async () => {
  schema = await getDb();
  dailyPlan = (await import('../../src/routes/daily-plan')).default;
  dailyReview = (await import('../../src/routes/daily-plan-review')).default;
});

const date = '2026-09-22';
const draft = {
  date,
  finishAt: '2026-09-22T22:00:00.000Z',
  mainTaskId: null,
  tasks: [],
  sessions: [],
};
const headers = { 'content-type': 'application/json' };

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a seeded database row');
  return value;
}

describe('daily planning draft and accepted history', () => {
  it('resumes a saved draft and keeps the first accepted plan after revision', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanning');
    const app = appWithSession(dailyPlan, fakeSession(userId));

    const saved = await app.request(`/day/${date}/draft`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ draft, resumeStep: 'plan_today' }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ draft, resumeStep: 'plan_today', accepted: null });

    const confirmed = await app.request(`/day/${date}/confirm`, { method: 'POST' });
    expect(confirmed.status).toBe(200);

    const revised = { ...draft, finishAt: '2026-09-22T23:00:00.000Z' };
    expect(
      (
        await app.request(`/day/${date}/draft`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ draft: revised, resumeStep: 'review_plan' }),
        })
      ).status,
    ).toBe(200);
    expect((await app.request(`/day/${date}/confirm`, { method: 'POST' })).status).toBe(200);

    const read = await app.request(`/day/${date}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      date,
      draft: null,
      tasks: [],
      agenda: { date, entries: [] },
      actual: [],
      accepted: {
        original: { snapshot: draft },
        current: { snapshot: revised },
        history: [{ snapshot: draft }, { snapshot: revised }],
      },
    });
  });

  it('rejects a draft whose date differs from the target day', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningMismatch');
    const app = appWithSession(dailyPlan, fakeSession(userId));
    const response = await app.request(`/day/${date}/draft`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ draft: { ...draft, date: '2026-09-23' }, resumeStep: 'plan_today' }),
    });
    expect(response.status).toBe(422);
  });

  it('does not save a pointer to work the caller cannot view', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningPrivate');
    const app = appWithSession(dailyPlan, fakeSession(userId));
    const response = await app.request(`/day/${date}/draft`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        draft: {
          ...draft,
          mainTaskId: 'other-task',
          tasks: [
            {
              taskId: 'other-task',
              organizationId: 'other-organization',
              plannedMinutes: 30,
              sort: 0,
            },
          ],
        },
        resumeStep: 'plan_today',
      }),
    });
    expect(response.status).toBe(404);
    expect((await app.request(`/day/${date}`)).status).toBe(200);
  });

  it('requires a saved draft before confirmation', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningNoDraft');
    const app = appWithSession(dailyPlan, fakeSession(userId));
    expect((await app.request(`/day/${date}/confirm`, { method: 'POST' })).status).toBe(409);
  });

  it('projects one selected task into Today while retaining both accepted sessions', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningProjection');
    const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Planner', userId });
    const statusId = await seedStatuses(schema.db, schema, orgId);
    const [task] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Write launch email',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    expect(task).toBeDefined();
    const taskId = required(task).id;
    const app = appWithSession(dailyPlan, fakeSession(userId));
    const sessions = [
      {
        id: 'morning',
        startsAt: '2026-09-22T16:00:00.000Z',
        endsAt: '2026-09-22T16:30:00.000Z',
        allocations: [{ taskId, plannedMinutes: 30 }],
        pinned: false,
      },
      {
        id: 'afternoon',
        startsAt: '2026-09-22T20:00:00.000Z',
        endsAt: '2026-09-22T20:30:00.000Z',
        allocations: [{ taskId, plannedMinutes: 30 }],
        pinned: false,
      },
    ];
    expect(
      (
        await app.request(`/day/${date}/draft`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            draft: {
              ...draft,
              tasks: [{ taskId, organizationId: orgId, plannedMinutes: 60, sort: 0 }],
              sessions,
            },
            resumeStep: 'review_plan',
          }),
        })
      ).status,
    ).toBe(200);
    expect((await app.request(`/day/${date}/confirm`, { method: 'POST' })).status).toBe(200);
    const [hubRow] = await schema.db
      .select({ id: schema.hub.id })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId));
    const items = await schema.db
      .select()
      .from(schema.dailyPlanItem)
      .where(eq(schema.dailyPlanItem.hubId, required(hubRow).id));
    expect(items.filter((item) => item.refTaskId === taskId)).toHaveLength(1);
    expect(items.find((item) => item.refTaskId === taskId)?.timeboxStartsAt?.toISOString()).toBe(
      required(sessions[0]).startsAt,
    );
    const read = (await (await app.request(`/day/${date}`)).json()) as {
      accepted: { current: { snapshot: { sessions: unknown[] } } };
      tasks: { taskId: string; planItemId: string | null }[];
      agenda: { entries: { kind: string; taskId?: string }[] };
    };
    expect(read.accepted.current.snapshot.sessions).toHaveLength(2);
    expect(read.tasks.find((entry) => entry.taskId === taskId)?.planItemId).toBe(items[0]?.id);
    expect(
      read.agenda.entries.filter(
        (entry: { kind: string; taskId?: string }) =>
          entry.kind === 'task_timebox' && entry.taskId === taskId,
      ),
    ).toHaveLength(2);
  });

  it('returns unfinished work from several earlier days in one review', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningCarryover');
    const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Planner', userId });
    const statusId = await seedStatuses(schema.db, schema, orgId);
    const [task] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Follow up with customer',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    const taskId = required(task).id;
    const app = appWithSession(dailyPlan, fakeSession(userId));
    expect(
      (
        await app.request('/', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            date: '2026-09-18',
            refOrganizationId: orgId,
            refTaskId: taskId,
          }),
        })
      ).status,
    ).toBe(201);
    const read = await app.request(`/day/${date}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      carryover: [
        {
          taskId,
          title: 'Follow up with customer',
          plannedDate: '2026-09-18',
        },
      ],
    });
    const prior = await schema.db
      .select({ id: schema.dailyPlanItem.id })
      .from(schema.dailyPlanItem)
      .where(eq(schema.dailyPlanItem.refTaskId, taskId));
    const reviewApp = appWithSession(dailyReview, fakeSession(userId));
    expect(
      (
        await reviewApp.request(`/day/${date}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            decisions: [
              { planItemId: required(prior[0]).id, action: 'another', targetDate: '2026-09-24' },
            ],
          }),
        })
      ).status,
    ).toBe(200);
    const after = await app.request(`/day/${date}`);
    expect(await after.json()).toMatchObject({ carryover: [] });
    const future = await app.request('/?date=2026-09-24');
    expect(await future.json()).toMatchObject({ items: [{ refTaskId: taskId }] });
  });
});
