import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let meNotifications!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { NotificationInboxService } = await import('../../src/services/notifications/inbox');
  const { createMeNotificationsRoutes } = await import('../../src/routes/me-notifications');
  meNotifications = createMeNotificationsRoutes(new NotificationInboxService(db));
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function freshUser(): string {
  return `user_${Math.random().toString(36).slice(2, 10)}`;
}

async function seedNotification(userId: string, title = 'hello'): Promise<string> {
  const [n] = await db
    .insert(schema.notification)
    .values({
      userId,
      type: 'service_announcement',
      body: { title },
    })
    .returning({ id: schema.notification.id });
  if (!n) throw new Error('expected notification row');
  return n.id;
}

describe('me notifications router', () => {
  it('requires a signed-in user for the personal inbox alias', async () => {
    const app = appWithSession(meNotifications, null);

    expect((await app.request('/')).status).toBe(401);
    expect((await app.request('/count')).status).toBe(401);
  });

  it('lists, fetches, marks, and acts on only the signed-in user notifications', async () => {
    const me = freshUser();
    const them = freshUser();
    const mine = await seedNotification(me, 'mine');
    await seedNotification(them, 'theirs');
    const app = appWithSession(meNotifications, fakeSession(me));

    const listed = await body<{ items: { id: string; body: { title: string } }[] }>(
      await app.request('/'),
    );
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ id: mine, body: { title: 'mine' } });

    const detail = await app.request(`/${mine}`);
    expect(detail.status).toBe(200);
    expect(await body<{ id: string }>(detail)).toMatchObject({ id: mine });

    const read = await app.request(`/${mine}/read`, { method: 'POST' });
    expect(read.status).toBe(200);
    expect(await body<{ id: string; readAt: string | null }>(read)).toMatchObject({
      id: mine,
      readAt: expect.any(String),
    });

    const acted = await app.request(`/${mine}/act`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ action: 'acknowledge' }),
    });
    expect(acted.status).toBe(200);

    expect((await body<{ unread: number }>(await app.request('/count'))).unread).toBe(0);
  });

  it('hides missing and other-user notifications behind 404', async () => {
    const me = freshUser();
    const them = freshUser();
    const theirs = await seedNotification(them, 'private');
    const app = appWithSession(meNotifications, fakeSession(me));

    expect((await app.request('/missing')).status).toBe(404);
    expect((await app.request(`/${theirs}`)).status).toBe(404);
  });
});
