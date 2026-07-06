import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  dispatchNotificationIntent,
  type DispatchNotificationIntentInput,
} from '../../../src/services/notifications/dispatcher';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../../routes/harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let notifications!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  const { NotificationInboxService } = await import('../../../src/services/notifications/inbox');
  const { NotificationIntentService } =
    await import('../../../src/services/notifications/intent-service');
  const { createNotificationsRoutes } = await import('../../../src/routes/notifications');
  notifications = createNotificationsRoutes(
    new NotificationInboxService(db),
    new NotificationIntentService(db),
  );
});

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function key(name: string): string {
  return `${name}-${Math.random().toString(36).slice(2)}`;
}

describe('dispatchNotificationIntent — web channel', () => {
  it('persists the intent graph, projects a web inbox row, and increments unread count', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherWebRecipient');

    const result = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['web'],
      subject: 'Scheduled maintenance',
      body: { text: 'Maintenance tonight.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-web'),
    });

    expect(result).toMatchObject({
      status: 'sent',
      idempotent: false,
      recipients: [{ userId, organizationId: null, reason: 'explicit' }],
      deliveries: [{ channel: 'web', destinationType: 'in_app', status: 'sent' }],
      webNotifications: [
        {
          userId,
          organizationId: null,
          type: 'service_announcement',
          body: {
            title: 'Scheduled maintenance',
            summary: 'Maintenance tonight.',
            category: 'service_announcement',
          },
        },
      ],
    });

    const intents = await db
      .select()
      .from(schema.notificationIntent)
      .where(eq(schema.notificationIntent.id, result.intentId));
    expect(intents).toMatchObject([
      {
        id: result.intentId,
        senderType: 'system',
        category: 'service_announcement',
        status: 'sent',
      },
    ]);

    const recipients = await db
      .select()
      .from(schema.notificationRecipient)
      .where(eq(schema.notificationRecipient.notificationId, result.intentId));
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ userId, organizationId: null, reason: 'explicit' });

    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, result.intentId));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      recipientId: recipients[0]!.id,
      channel: 'web',
      destinationType: 'in_app',
      destination: { type: 'in_app' },
      status: 'sent',
    });
    expect(deliveries[0]!.sentAt).toBeInstanceOf(Date);

    const inboxRows = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.intentId, result.intentId));
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]).toMatchObject({
      deliveryId: deliveries[0]!.id,
      userId,
      organizationId: null,
      type: 'service_announcement',
      body: {
        title: 'Scheduled maintenance',
        summary: 'Maintenance tonight.',
        category: 'service_announcement',
      },
      readAt: null,
    });

    const app = appWithSession(notifications, fakeSession(userId));
    const counts = await body<{ unread: number; pendingApprovals: number }>(
      await app.request('/count'),
    );
    expect(counts).toEqual({ unread: 1, pendingApprovals: 0 });
  });

  it('uses idempotency keys to avoid duplicate recipients, deliveries, and inbox rows', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherIdempotentRecipient');
    const idempotencyKey = key('dispatcher-idempotent');
    const input: DispatchNotificationIntentInput = {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['web'],
      subject: 'Repeated maintenance notice',
      body: { text: 'Same notice.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey,
    };

    const first = await dispatchNotificationIntent(db, input);
    const second = await dispatchNotificationIntent(db, input);

    expect(second.intentId).toBe(first.intentId);
    expect(second.idempotent).toBe(true);

    const intents = await db
      .select()
      .from(schema.notificationIntent)
      .where(eq(schema.notificationIntent.idempotencyKey, idempotencyKey));
    expect(intents).toHaveLength(1);

    const recipients = await db
      .select()
      .from(schema.notificationRecipient)
      .where(eq(schema.notificationRecipient.notificationId, first.intentId));
    expect(recipients).toHaveLength(1);

    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, first.intentId));
    expect(deliveries).toHaveLength(1);

    const inboxRows = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.intentId, first.intentId),
          eq(schema.notification.userId, userId),
        ),
      );
    expect(inboxRows).toHaveLength(1);
  });
});
