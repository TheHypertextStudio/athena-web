import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb, seedBaseOrg } from '../support/routes-harness';
import type notificationsRouter from '../../src/routes/notifications';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let notifications!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { createNotificationRouteDependencies } =
    await import('../../src/services/notifications/dependencies');
  const { createNotificationsRoutes } = await import('../../src/routes/notifications');
  notifications = createNotificationsRoutes(createNotificationRouteDependencies());
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A fresh user id unique per test, so each test owns an isolated inbox. */
function freshUser(): string {
  return `user_${Math.random().toString(36).slice(2, 10)}`;
}

/** The notification `type` enum value, derived from the schema insert type. */
type NotificationKind = NonNullable<(typeof schema.notification)['$inferInsert']['type']>;

/** Seed a notification for `userId` (optionally org-scoped / pre-read). */
async function seedNotification(
  userId: string,
  opts: {
    organizationId?: string | null;
    type?: NotificationKind;
    title?: string;
    readAt?: Date | null;
  } = {},
): Promise<string> {
  const [n] = await db
    .insert(schema.notification)
    .values({
      userId,
      organizationId: opts.organizationId ?? null,
      type: opts.type ?? 'mention',
      body: { title: opts.title ?? 'hi' },
      ...(opts.readAt !== undefined ? { readAt: opts.readAt } : {}),
    })
    .returning({ id: schema.notification.id });
  return n!.id;
}

describe('notifications router — auth', () => {
  it('401 without a session on every verb', async () => {
    const app = appWithSession(notifications, null);
    expect((await app.request('/')).status).toBe(401);
    expect((await app.request('/count')).status).toBe(401);
    expect(
      (await app.request('/read-all', { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(401);
    expect((await app.request(`/${MISSING}/read`, { method: 'POST' })).status).toBe(401);
    expect(
      (
        await app.request(`/${MISSING}/act`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ action: 'acknowledge' }),
        })
      ).status,
    ).toBe(401);
  });
});

describe('notifications router — list + unread filter', () => {
  it('lists the caller inbox newest-first and honors unreadOnly + filters', async () => {
    const userId = freshUser();
    const { orgId } = await seedBaseOrg(db, schema);
    const { orgId: otherOrgId } = await seedBaseOrg(db, schema);
    const app = appWithSession(notifications, fakeSession(userId));

    await seedNotification(userId, { organizationId: orgId, type: 'mention', title: 'a' });
    await seedNotification(userId, {
      organizationId: orgId,
      type: 'approval_request',
      title: 'b',
    });
    // One already-read notification and one in a different org.
    await seedNotification(userId, {
      organizationId: orgId,
      type: 'assignment',
      title: 'read',
      readAt: new Date(),
    });
    await seedNotification(userId, { organizationId: otherOrgId, type: 'mention', title: 'other' });

    const all = await app.request('/');
    expect(all.status).toBe(200);
    expect((await body<{ items: unknown[] }>(all)).items).toHaveLength(4);

    // unreadOnly drops the pre-read row.
    const unread = await app.request('/?unreadOnly=true');
    expect((await body<{ items: unknown[] }>(unread)).items).toHaveLength(3);

    // organizationId narrows to one org's notifications.
    const scoped = await app.request(`/?organizationId=${orgId}`);
    expect((await body<{ items: unknown[] }>(scoped)).items).toHaveLength(3);

    // type narrows to a single kind.
    const byType = await app.request('/?type=approval_request');
    const typed = await body<{ items: { type: string }[] }>(byType);
    expect(typed.items).toHaveLength(1);
    expect(typed.items[0]!.type).toBe('approval_request');

    // Combined filters AND together.
    const combined = await app.request(`/?organizationId=${orgId}&unreadOnly=true&type=mention`);
    expect((await body<{ items: unknown[] }>(combined)).items).toHaveLength(1);
  });

  it('rejects an invalid type filter with 422', async () => {
    const app = appWithSession(notifications, fakeSession(freshUser()));
    expect((await app.request('/?type=not_a_type')).status).toBe(422);
  });

  it('isolates one user inbox from another (tenant/owner isolation)', async () => {
    const me = freshUser();
    const them = freshUser();
    await seedNotification(me, { title: 'mine' });
    await seedNotification(them, { title: 'theirs' });

    const app = appWithSession(notifications, fakeSession(me));
    const listed = await app.request('/');
    const items = (await body<{ items: { body: { title: string } }[] }>(listed)).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.body.title).toBe('mine');
  });
});

describe('notifications router — count', () => {
  it('counts unread + pending approvals across orgs, ignoring read rows', async () => {
    const userId = freshUser();
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithSession(notifications, fakeSession(userId));

    await seedNotification(userId, { type: 'mention' });
    await seedNotification(userId, { type: 'approval_request' });
    await seedNotification(userId, { type: 'approval_request' });
    await seedNotification(userId, {
      organizationId: orgId,
      type: 'assignment',
      readAt: new Date(),
    });

    const res = await app.request('/count');
    expect(res.status).toBe(200);
    const counts = await body<{ unread: number; pendingApprovals: number }>(res);
    expect(counts.unread).toBe(3);
    expect(counts.pendingApprovals).toBe(2);
  });

  it('returns zero for an empty inbox', async () => {
    const app = appWithSession(notifications, fakeSession(freshUser()));
    const counts = await body<{ unread: number; pendingApprovals: number }>(
      await app.request('/count'),
    );
    expect(counts).toEqual({ unread: 0, pendingApprovals: 0 });
  });
});

describe('notifications router — read-all', () => {
  it('marks all unread read, is idempotent, and reports the transition count', async () => {
    const userId = freshUser();
    const app = appWithSession(notifications, fakeSession(userId));
    await seedNotification(userId, { type: 'mention' });
    await seedNotification(userId, { type: 'approval_request' });
    await seedNotification(userId, { type: 'assignment', readAt: new Date() });

    const first = await app.request('/read-all', { method: 'POST', headers: J, body: '{}' });
    expect(first.status).toBe(200);
    expect((await body<{ updated: number }>(first)).updated).toBe(2);

    // Idempotent: nothing left unread.
    const second = await app.request('/read-all', { method: 'POST', headers: J, body: '{}' });
    expect((await body<{ updated: number }>(second)).updated).toBe(0);

    const countRes = await body<{ unread: number }>(await app.request('/count'));
    expect(countRes.unread).toBe(0);
  });

  it('scopes the bulk mark-read to a single org when organizationId is given', async () => {
    const userId = freshUser();
    const { orgId } = await seedBaseOrg(db, schema);
    const { orgId: otherOrgId } = await seedBaseOrg(db, schema);
    const app = appWithSession(notifications, fakeSession(userId));
    await seedNotification(userId, { organizationId: orgId, type: 'mention' });
    await seedNotification(userId, { organizationId: otherOrgId, type: 'mention' });

    const res = await app.request('/read-all', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ organizationId: orgId }),
    });
    expect((await body<{ updated: number }>(res)).updated).toBe(1);

    // The other org's notification is still unread.
    const remaining = await body<{ unread: number }>(await app.request('/count'));
    expect(remaining.unread).toBe(1);
  });

  it('scopes the bulk mark-read to a single type when type is given', async () => {
    const userId = freshUser();
    const app = appWithSession(notifications, fakeSession(userId));
    await seedNotification(userId, { type: 'mention' });
    await seedNotification(userId, { type: 'approval_request' });

    const res = await app.request('/read-all', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ type: 'approval_request' }),
    });
    expect((await body<{ updated: number }>(res)).updated).toBe(1);
    expect((await body<{ unread: number }>(await app.request('/count'))).unread).toBe(1);
  });

  it('does not touch another user notifications', async () => {
    const me = freshUser();
    const them = freshUser();
    await seedNotification(me, { type: 'mention' });
    const theirId = await seedNotification(them, { type: 'mention' });

    const app = appWithSession(notifications, fakeSession(me));
    await app.request('/read-all', { method: 'POST', headers: J, body: '{}' });

    const theirs = await db
      .select({ readAt: schema.notification.readAt })
      .from(schema.notification)
      .where(eq(schema.notification.id, theirId));
    expect(theirs[0]!.readAt).toBeNull();
  });

  it('rejects an invalid type in the body with 422', async () => {
    const app = appWithSession(notifications, fakeSession(freshUser()));
    const res = await app.request('/read-all', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ type: 'bogus' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('notifications router — :id/read', () => {
  it('marks a single notification read and returns it', async () => {
    const userId = freshUser();
    const app = appWithSession(notifications, fakeSession(userId));
    const id = await seedNotification(userId, { type: 'mention' });

    const res = await app.request(`/${id}/read`, { method: 'POST' });
    expect(res.status).toBe(200);
    const out = await body<{ id: string; readAt: string | null }>(res);
    expect(out.id).toBe(id);
    expect(out.readAt).not.toBeNull();
  });

  it('404 for a missing / another-user notification', async () => {
    const me = freshUser();
    const them = freshUser();
    const theirId = await seedNotification(them, { type: 'mention' });
    const app = appWithSession(notifications, fakeSession(me));

    expect((await app.request(`/${MISSING}/read`, { method: 'POST' })).status).toBe(404);
    // Existence-hiding: another user's row reads as not-found.
    expect((await app.request(`/${theirId}/read`, { method: 'POST' })).status).toBe(404);
  });
});

describe('notifications router — :id/act', () => {
  it('marks a notification acted (read) and returns it', async () => {
    const userId = freshUser();
    const app = appWithSession(notifications, fakeSession(userId));
    const id = await seedNotification(userId, { type: 'approval_request' });

    const res = await app.request(`/${id}/act`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ action: 'approve' }),
    });
    expect(res.status).toBe(200);
    const out = await body<{ id: string; readAt: string | null }>(res);
    expect(out.id).toBe(id);
    expect(out.readAt).not.toBeNull();

    // It is now read, so the unread count drops it.
    expect((await body<{ unread: number }>(await app.request('/count'))).unread).toBe(0);
  });

  it('422 when the action body is missing or empty', async () => {
    const userId = freshUser();
    const id = await seedNotification(userId, { type: 'mention' });
    const app = appWithSession(notifications, fakeSession(userId));

    expect(
      (await app.request(`/${id}/act`, { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(422);
    expect(
      (
        await app.request(`/${id}/act`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ action: '' }),
        })
      ).status,
    ).toBe(422);
  });

  it('404 for a missing / another-user notification', async () => {
    const me = freshUser();
    const them = freshUser();
    const theirId = await seedNotification(them, { type: 'mention' });
    const app = appWithSession(notifications, fakeSession(me));
    const act = (id: string) =>
      app.request(`/${id}/act`, {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ action: 'acknowledge' }),
      });

    expect((await act(MISSING)).status).toBe(404);
    expect((await act(theirId)).status).toBe(404);
  });
});
