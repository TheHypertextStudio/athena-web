import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type dailyPlanRouter from '../../src/routes/daily-plan';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../support/routes-harness';

let schema: typeof DbModule;
let dailyPlan: typeof dailyPlanRouter;

beforeAll(async () => {
  schema = await getDb();
  dailyPlan = (await import('../../src/routes/daily-plan')).default;
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
});
