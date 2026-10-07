import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

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

async function assertAcceptedMutationGuard(
  app: ReturnType<typeof appWithSession>,
  itemId: string,
): Promise<void> {
  const before = await (await app.request(`/day/${date}`)).json();
  for (const body of [{ timeboxStartsAt: '2026-09-22T17:00:00.000Z' }, { timeboxEndsAt: null }]) {
    const response = await app.request(`/${itemId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'accepted_plan_requires_revision' });
  }
  const removal = await app.request(`/${itemId}`, { method: 'DELETE' });
  expect(removal.status).toBe(409);
  expect(await removal.json()).toMatchObject({ code: 'accepted_plan_requires_revision' });
  expect(await (await app.request(`/day/${date}`)).json()).toEqual(before);
  expect(
    (
      await app.request(`/${itemId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'done', sort: 1 }),
      })
    ).status,
  ).toBe(200);
}

describe('daily planning draft and accepted history', () => {
  it('binds the acceptance release timestamp as a driver-safe ISO value', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningTimestamp');
    const app = appWithSession(dailyPlan, fakeSession(userId));
    await app.request(`/day/${date}/draft`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ draft, resumeStep: 'review_plan' }),
    });
    let parameters: readonly unknown[] = [];
    schema.setDatabaseQueryObserver((query, values) => {
      if (query.includes('day_directive') && query.includes('coalesce')) parameters = values;
    });
    try {
      expect((await app.request(`/day/${date}/confirm`, { method: 'POST' })).status).toBe(200);
      expect(parameters.length).toBeGreaterThan(0);
      expect(parameters.some((value) => value instanceof Date)).toBe(false);
    } finally {
      schema.setDatabaseQueryObserver(undefined);
    }
  });
  it('rejects stale draft saves and increments the accepted revision', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningRevision');
    const app = appWithSession(dailyPlan, fakeSession(userId));
    const save = (expectedRevision: number) =>
      app.request(`/day/${date}/draft`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ draft, resumeStep: 'plan_today', expectedRevision }),
      });
    expect(await (await app.request(`/day/${date}`)).json()).toMatchObject({ revision: 0 });
    expect(await (await save(0)).json()).toMatchObject({ revision: 1 });
    expect((await save(0)).status).toBe(409);
    expect(
      (
        await app.request(`/day/${date}/confirm`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedRevision: 0 }),
        })
      ).status,
    ).toBe(409);
    expect(
      await (
        await app.request(`/day/${date}/confirm`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ expectedRevision: 1 }),
        })
      ).json(),
    ).toMatchObject({ revision: 2 });
    const [release] = await schema.db
      .select()
      .from(schema.dayDirective)
      .innerJoin(schema.hub, eq(schema.hub.id, schema.dayDirective.hubId))
      .where(eq(schema.hub.userId, userId));
    expect(release?.day_directive.agendaAcknowledgedAt).toBeInstanceOf(Date);
  });

  it('returns a read-only proposal with an editable fallback when no schedule exists', async () => {
    const userId = await seedUserWithHub(schema.db, schema, 'DailyPlanningProposal');
    const app = appWithSession(dailyPlan, fakeSession(userId));
    const response = await app.request('/day/2027-01-05/proposal', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revision: 0,
      workScheduleMissing: true,
      tasks: [],
      unplaced: [],
      draft: { date: '2027-01-05' },
    });
    expect(await (await app.request('/day/2027-01-05')).json()).toMatchObject({
      draft: null,
      accepted: null,
      revision: 0,
    });
  });

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
    await assertAcceptedMutationGuard(app, required(items[0]).id);
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
    for (const plannedDate of ['2026-09-17', '2026-09-18'])
      expect(
        (
          await app.request('/', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              date: plannedDate,
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
      .where(
        and(
          eq(schema.dailyPlanItem.refTaskId, taskId),
          eq(schema.dailyPlanItem.date, '2026-09-18'),
        ),
      );
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
