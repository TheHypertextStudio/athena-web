import type * as DbModule from '@docket/db';
import {
  PushSendError,
  type OutboundPush,
  type PushSender,
  type SentPush,
} from '@docket/integrations';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { deliverPushNotification } from '../../../src/dispatch/adapters/push';
import { getMigratedDb } from '../../support/db';
import { seedContactPoint, seedUser } from '../../support/seed';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

/** A capturing {@link PushSender}, optionally scripted to reject with a given error. */
function fakePush(failWith?: Error): { push: PushSender; sent: OutboundPush[] } {
  const sent: OutboundPush[] = [];
  const push: PushSender = {
    send: async (message) => {
      if (failWith) throw failWith;
      sent.push(message);
      const result: SentPush = { ...message, id: 'push_1', sentAt: '2026-07-07T17:00:00.000Z' };
      return result;
    },
  };
  return { push, sent };
}

async function seedDeliveryChain(userId: string, contactPointId?: string): Promise<string> {
  const [intent] = await db
    .insert(schema.notificationIntent)
    .values({
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['push'],
      subject: 'Subject',
      body: { text: 'Body' },
      createdBy: 'system',
    })
    .returning();
  const [recipient] = await db
    .insert(schema.notificationRecipient)
    .values({ notificationId: intent!.id, userId, organizationId: null, reason: 'explicit' })
    .returning();
  const [delivery] = await db
    .insert(schema.notificationDelivery)
    .values({
      notificationId: intent!.id,
      recipientId: recipient!.id,
      channel: 'push',
      destinationType: 'push_token',
      destination: contactPointId ? { type: 'push_token', contactPointId } : {},
      status: 'queued',
    })
    .returning();
  return delivery!.id;
}

describe('deliverPushNotification', () => {
  it('sends through the sender with notification/delivery ids in data and marks sent', async () => {
    const userId = await seedUser(db, schema, 'AdapterPushSent');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'token-1',
      valueNormalized: 'token-1',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { push, sent } = fakePush();

    const result = await deliverPushNotification(db, {
      notificationId: 'intent_x',
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body text' },
      now: new Date('2026-07-07T17:00:00.000Z'),
      push,
    });

    expect(sent).toEqual([
      {
        token: 'token-1',
        title: 'Hello',
        body: 'Body text',
        data: { notificationId: 'intent_x', deliveryId },
      },
    ]);
    expect(result).toMatchObject({
      status: 'sent',
      providerMessageId: 'push_1',
      providerPayload: { sentAt: '2026-07-07T17:00:00.000Z' },
    });
  });

  it('omits the body key when the notification body has no text', async () => {
    const userId = await seedUser(db, schema, 'AdapterPushNoText');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'token-2',
      valueNormalized: 'token-2',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { push, sent } = fakePush();

    await deliverPushNotification(db, {
      notificationId: 'intent_y',
      deliveryId,
      subject: 'Title only',
      body: {},
      now: new Date(),
      push,
    });

    expect(sent[0]).not.toHaveProperty('body');
  });

  it('marks the delivery failed when there is no active verified push contact point', async () => {
    const userId = await seedUser(db, schema, 'AdapterPushNoContact');
    const deliveryId = await seedDeliveryChain(userId);
    const { push, sent } = fakePush();

    const result = await deliverPushNotification(db, {
      notificationId: 'intent_z',
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      push,
    });

    expect(sent).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'push_contact_point_not_found',
      errorMessage: 'Push delivery failed',
    });
  });

  it('disables the contact point and marks the delivery failed on an invalid-token error', async () => {
    const userId = await seedUser(db, schema, 'AdapterPushInvalidToken');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'dead-token',
      valueNormalized: 'dead-token',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { push } = fakePush(new PushSendError('invalid_token', 'gone'));
    const now = new Date('2026-07-07T17:00:00.000Z');

    const result = await deliverPushNotification(db, {
      notificationId: 'intent_invalid',
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now,
      push,
    });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'push_invalid_token' });
    const [updatedPoint] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, point.id));
    expect(updatedPoint).toMatchObject({ status: 'disabled' });
    expect(updatedPoint?.disabledAt).toEqual(now);
  });

  it('marks the delivery failed without disabling the contact point on a generic provider error', async () => {
    const userId = await seedUser(db, schema, 'AdapterPushProviderError');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'flaky-token',
      valueNormalized: 'flaky-token',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { push } = fakePush(new PushSendError('provider_error', 'try again'));

    const result = await deliverPushNotification(db, {
      notificationId: 'intent_provider_error',
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      push,
    });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'push_send_failed' });
    const [updatedPoint] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, point.id));
    expect(updatedPoint).toMatchObject({ status: 'active' });
  });

  it('marks the delivery failed on a non-PushSendError failure', async () => {
    const userId = await seedUser(db, schema, 'AdapterPushGenericError');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'other-token',
      valueNormalized: 'other-token',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { push } = fakePush(new Error('network blip'));

    const result = await deliverPushNotification(db, {
      notificationId: 'intent_generic',
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      push,
    });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'push_send_failed' });
  });
});
