import { beforeAll, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import type DailyPlanRouter from '../../src/routes/daily-plan';
import {
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema: typeof DbModule;
let router: typeof DailyPlanRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/daily-plan')).default;
});

interface WorkPage {
  items: { id: string; title: string }[];
  nextCursor?: string;
}
async function readPage(response: Response): Promise<WorkPage> {
  expect(response.status).toBe(200);
  return (await response.json()) as WorkPage;
}

async function fixture() {
  const userId = await seedUserWithHub(schema.db, schema, 'PlanningWork');
  const org = await seedBaseOrg(schema.db, schema);
  await schema.db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, org.humanActorId));
  const app = appWithSession(router, fakeSession(userId));
  const insert = async (title: string, fields: Partial<typeof schema.task.$inferInsert> = {}) => {
    const [row] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: org.orgId,
        teamId: org.teamId,
        statusId: org.statusId('task', 'todo'),
        state: 'todo',
        title,
        visibility: 'public',
        ...fields,
      })
      .returning();
    if (!row) throw new Error('Missing fixture task');
    return row;
  };
  return { ...org, userId, app, insert };
}

it('browses assigned and authored live tasks without a search index or a daily selection', async () => {
  const f = await fixture();
  const assigned = await f.insert('Assigned work', { assigneeId: f.humanActorId });
  const authored = await f.insert('Authored work', { createdBy: f.humanActorId });
  await f.insert('Someone else’s work');
  await f.insert('Finished work', { createdBy: f.humanActorId, completedAt: new Date() });
  await f.insert('Canceled work', { createdBy: f.humanActorId, canceledAt: new Date() });
  await f.insert('Archived work', { createdBy: f.humanActorId, archivedAt: new Date() });
  const response = await f.app.request('/work?date=2026-11-04');
  expect(response.status).toBe(200);
  const body = await readPage(response);
  expect(body.items.map((item: { id: string }) => item.id).sort()).toEqual(
    [assigned.id, authored.id].sort(),
  );
});

it('paginates hundreds of tasks without omissions and searches beyond the first page', async () => {
  const f = await fixture();
  await schema.db.insert(schema.task).values(
    Array.from({ length: 125 }, (_, i) => ({
      organizationId: f.orgId,
      teamId: f.teamId,
      statusId: f.statusId('task', 'todo'),
      state: 'todo',
      title: `Planning backlog ${i}`,
      visibility: 'public' as const,
      createdBy: f.humanActorId,
    })),
  );
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({
      date: '2026-11-04',
      limit: '30',
      ...(cursor ? { cursor } : {}),
    });
    const response = await f.app.request(`/work?${query.toString()}`);
    expect(response.status).toBe(200);
    const body = await readPage(response);
    ids.push(...body.items.map((item: { id: string }) => item.id));
    cursor = body.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(125);
  expect(new Set(ids).size).toBe(125);
  const found = await readPage(await f.app.request('/work?date=2026-11-04&q=backlog%20124'));
  expect(found.items).toHaveLength(1);
  expect(found.items[0]?.title).toBe('Planning backlog 124');
});

it('keeps workspace scope and canonical task visibility when browsing all work', async () => {
  const f = await fixture();
  const other = await seedBaseOrg(schema.db, schema);
  await schema.db.insert(schema.task).values({
    organizationId: other.orgId,
    teamId: other.teamId,
    statusId: other.statusId('task', 'todo'),
    state: 'todo',
    title: 'Other workspace',
    createdBy: f.humanActorId,
  });
  await f.insert('Private work', { visibility: 'private' });
  await f.insert('Visible work', { createdBy: f.humanActorId });
  const response = await f.app.request('/work?date=2026-11-04&scope=all');
  expect(response.status).toBe(200);
  expect((await readPage(response)).items.map((item: { title: string }) => item.title)).toEqual([
    'Visible work',
  ]);
});

it('filters assigned, created, due work and literal search text', async () => {
  const f = await fixture();
  await f.insert('Due 100% work', {
    assigneeId: f.humanActorId,
    dueDate: new Date('2026-11-04T12:00:00Z'),
  });
  await f.insert('Undated authored work', { createdBy: f.humanActorId });
  const read = async (query: string) =>
    (await readPage(await f.app.request(`/work?date=2026-11-04&${query}`))).items;
  expect((await read('scope=assigned')).map((item: { title: string }) => item.title)).toEqual([
    'Due 100% work',
  ]);
  expect((await read('scope=created')).map((item: { title: string }) => item.title)).toEqual([
    'Undated authored work',
  ]);
  expect(await read('due=true')).toHaveLength(1);
  expect(await read('q=100%25')).toHaveLength(1);
  expect(await read(`orgId=${'0'.repeat(26)}`)).toHaveLength(0);
});

it('retains configured work hours when planning after the day has ended', async () => {
  const userId = await seedUserWithHub(schema.db, schema, 'AfterWorkHours');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-05T21:00:00.000Z'));
  try {
    const app = appWithSession(router, fakeSession(userId));
    const response = await app.request('/day/2027-01-05/proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      startAt: string;
      draft: { settings: { startAt: string }; finishAt: string };
      availableMinutes: number;
    };
    expect(result.startAt).toBe('2027-01-05T09:00:00.000Z');
    expect(result.draft.settings.startAt).toBe('2027-01-05T09:00:00.000Z');
    expect(result.draft.finishAt).toBe('2027-01-05T17:00:00.000Z');
    expect(result.availableMinutes).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
