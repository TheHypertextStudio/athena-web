import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { appWithSession, fakeSession, getDb, seedUserWithHub } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let notifications!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { NotificationInboxService } = await import('../../src/services/notifications/inbox');
  const { NotificationIntentService } =
    await import('../../src/services/notifications/intent-service');
  const { createNotificationsRoutes } = await import('../../src/routes/notifications');
  notifications = createNotificationsRoutes(
    new NotificationInboxService(db),
    new NotificationIntentService(db),
  );
});

const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function key(name: string): string {
  return `${name}-${Math.random().toString(36).slice(2)}`;
}

async function seedStaffUser(role: 'support' | 'finance' | 'superadmin' = 'support') {
  const userId = await seedUserWithHub(db, schema, `NotificationStaff${key(role)}`);
  const [staff] = await db
    .insert(schema.staffUser)
    .values({ userId, role })
    .returning({ id: schema.staffUser.id });
  if (!staff) throw new Error('expected staff row');
  return { userId, staffUserId: staff.id };
}

function serviceAnnouncementInput(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    senderType: 'staff',
    category: 'service_announcement',
    priority: 'normal',
    audience: { type: 'user', userId },
    channels: ['web'],
    subject: 'Scheduled maintenance',
    body: { text: 'Maintenance tonight.' },
    replyPolicy: 'none',
    idempotencyKey: key('intent-route'),
    ...overrides,
  };
}

describe('notification intent routes', () => {
  it('requires staff access to create a staff/system service announcement', async () => {
    const callerId = await seedUserWithHub(db, schema, 'NotificationCivilian');
    const recipientId = await seedUserWithHub(db, schema, 'NotificationCivilianRecipient');
    const app = appWithSession(notifications, fakeSession(callerId));

    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(serviceAnnouncementInput(recipientId)),
    });

    expect(res.status).toBe(403);
  });

  it('creates a draft intent without snapshotting recipients or deliveries', async () => {
    const staff = await seedStaffUser();
    const recipientId = await seedUserWithHub(db, schema, 'NotificationDraftRecipient');
    const app = appWithSession(notifications, fakeSession(staff.userId));

    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify(serviceAnnouncementInput(recipientId)),
    });

    expect(res.status).toBe(200);
    const intent = await body<{ id: string; status: string; createdBy: string }>(res);
    expect(intent).toMatchObject({ status: 'draft', createdBy: staff.userId });

    const recipients = await db
      .select()
      .from(schema.notificationRecipient)
      .where(eq(schema.notificationRecipient.notificationId, intent.id));
    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, intent.id));
    expect(recipients).toHaveLength(0);
    expect(deliveries).toHaveLength(0);
  });

  it('sends a draft intent and exposes the intent, recipients, and deliveries', async () => {
    const staff = await seedStaffUser();
    const recipientId = await seedUserWithHub(db, schema, 'NotificationSendRecipient');
    const app = appWithSession(notifications, fakeSession(staff.userId));

    const created = await body<{ id: string }>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify(serviceAnnouncementInput(recipientId)),
      }),
    );

    const sent = await app.request(`/${created.id}/send`, { method: 'POST' });
    expect(sent.status).toBe(200);
    expect(await body<{ id: string; status: string }>(sent)).toMatchObject({
      id: created.id,
      status: 'sent',
    });

    const fetched = await body<{ id: string; status: string }>(await app.request(`/${created.id}`));
    expect(fetched).toMatchObject({ id: created.id, status: 'sent' });

    const recipients = await body<{ items: { userId: string; reason: string }[] }>(
      await app.request(`/${created.id}/recipients`),
    );
    expect(recipients.items).toMatchObject([{ userId: recipientId, reason: 'explicit' }]);

    const deliveries = await body<{ items: { channel: string; status: string }[] }>(
      await app.request(`/${created.id}/deliveries`),
    );
    expect(deliveries.items).toMatchObject([{ channel: 'web', status: 'sent' }]);
  });

  it('cancels a scheduled intent before delivery', async () => {
    const staff = await seedStaffUser();
    const recipientId = await seedUserWithHub(db, schema, 'NotificationCancelRecipient');
    const app = appWithSession(notifications, fakeSession(staff.userId));

    const created = await body<{ id: string; status: string }>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify(
          serviceAnnouncementInput(recipientId, {
            scheduledAt: '2026-07-07T05:00:00.000Z',
          }),
        ),
      }),
    );
    expect(created.status).toBe('scheduled');

    const canceled = await app.request(`/${created.id}/cancel`, { method: 'POST' });
    expect(canceled.status).toBe(200);
    expect(await body<{ id: string; status: string }>(canceled)).toMatchObject({
      id: created.id,
      status: 'canceled',
    });
  });

  it('requires staff access for test sends', async () => {
    const staff = await seedStaffUser();
    const recipientId = await seedUserWithHub(db, schema, 'NotificationTestRecipient');
    const app = appWithSession(notifications, fakeSession(staff.userId));
    const created = await body<{ id: string }>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify(serviceAnnouncementInput(recipientId)),
      }),
    );

    const civilianId = await seedUserWithHub(db, schema, 'NotificationTestCivilian');
    const civilianApp = appWithSession(notifications, fakeSession(civilianId));
    expect((await civilianApp.request(`/${created.id}/test`, { method: 'POST' })).status).toBe(403);

    const testSend = await app.request(`/${created.id}/test`, { method: 'POST' });
    expect(testSend.status).toBe(200);
    expect(
      await body<{ status: string; webNotifications: { userId: string }[] }>(testSend),
    ).toMatchObject({
      status: 'sent',
      webNotifications: [{ userId: staff.userId }],
    });
  });
});
