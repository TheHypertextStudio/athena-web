import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  dispatchNotificationIntent,
  type DispatchNotificationIntentInput,
} from '../../../src/services/notifications/dispatcher';
import { captureOutbox, getDb, one, seedUserWithHub } from '../../routes/harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

function key(name: string): string {
  return `${name}-${Math.random().toString(36).slice(2)}`;
}

describe('dispatchNotificationIntent — email channel', () => {
  it('sends email through the capture mailer and keeps web unread state canonical', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherEmailRecipient');
    const email = await seedEmailContactPoint(userId, 'dispatcher-email@example.test');
    const outbox = await captureOutbox();
    const before = outbox.length;

    const result = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['web', 'email'],
      subject: 'Scheduled maintenance',
      body: {
        text: 'Maintenance tonight.',
        html: '<p>Maintenance tonight.</p>',
      },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-email'),
    });

    expect(outbox).toHaveLength(before + 1);
    expect(outbox.at(-1)).toMatchObject({
      to: 'dispatcher-email@example.test',
      subject: 'Scheduled maintenance',
      text: 'Maintenance tonight.',
      html: '<p>Maintenance tonight.</p>',
    });
    expect(result.status).toBe('sent');
    expect(result.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'web', destinationType: 'in_app', status: 'sent' }),
        expect.objectContaining({
          channel: 'email',
          destinationType: 'email',
          status: 'sent',
          destination: {
            type: 'email',
            contactPointId: email.id,
            valueMasked: 'd***@example.test',
          },
        }),
      ]),
    );
    expect(result.webNotifications).toMatchObject([
      {
        userId,
        type: 'service_announcement',
        readAt: null,
      },
    ]);

    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, result.intentId));
    const emailDelivery = deliveries.find((delivery) => delivery.channel === 'email');
    expect(emailDelivery).toMatchObject({
      status: 'sent',
      errorCode: null,
      errorMessage: null,
    });
    expect(emailDelivery?.sentAt).toBeInstanceOf(Date);

    const inboxRows = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.intentId, result.intentId),
          eq(schema.notification.userId, userId),
        ),
      );
    expect(inboxRows).toHaveLength(1);
    expect(inboxRows[0]?.readAt).toBeNull();
  });

  it('suppresses email without a verified contact point and does not send mail', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherEmailNoContact');
    const outbox = await captureOutbox();
    const before = outbox.length;

    const result = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['email'],
      subject: 'No email destination',
      body: { text: 'No email should be sent.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-email-no-contact'),
    });

    expect(outbox).toHaveLength(before);
    expect(result.deliveries).toMatchObject([
      {
        channel: 'email',
        destinationType: 'email',
        status: 'suppressed',
      },
    ]);
    expect(result.recipients[0]?.suppressions).toEqual([
      { reason: 'no_verified_contact_point', channel: 'email' },
    ]);
  });

  it('uses idempotency keys without sending duplicate email', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherEmailIdempotent');
    await seedEmailContactPoint(userId, 'idempotent-email@example.test');
    const outbox = await captureOutbox();
    const before = outbox.length;
    const idempotencyKey = key('dispatcher-email-idempotent');
    const input: DispatchNotificationIntentInput = {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['email'],
      subject: 'Only one email',
      body: { text: 'Send once.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey,
    };

    const first = await dispatchNotificationIntent(db, input);
    const second = await dispatchNotificationIntent(db, input);

    expect(second.intentId).toBe(first.intentId);
    expect(second.idempotent).toBe(true);
    expect(outbox).toHaveLength(before + 1);
    const deliveries = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.notificationId, first.intentId));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ channel: 'email', status: 'sent' });
  });
});

async function seedEmailContactPoint(
  userId: string,
  value: string,
): Promise<{ readonly id: string }> {
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'email',
        value,
        valueNormalized: value,
        valueMasked: `${value.slice(0, 1)}***@example.test`,
        status: 'active',
        primary: true,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
      })
      .returning({ id: schema.contactPoint.id }),
  );
}
