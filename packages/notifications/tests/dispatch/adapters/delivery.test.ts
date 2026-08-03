import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  activeDeliveryContactPoint,
  disableContactPoint,
  markDeliveryFailed,
  markDeliverySent,
  requireNotificationDelivery,
} from '../../../src/dispatch/adapters/delivery';
import { getMigratedDb } from '../../support/db';
import { seedContactPoint, seedUser } from '../../support/seed';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

/** Seed a full notification intent → recipient → delivery chain, returning their ids. */
async function seedDeliveryChain(
  userId: string,
  overrides: Partial<typeof schema.notificationDelivery.$inferInsert> = {},
): Promise<{
  readonly intentId: string;
  readonly recipientId: string;
  readonly deliveryId: string;
}> {
  const [intent] = await db
    .insert(schema.notificationIntent)
    .values({
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['email'],
      subject: 'Test',
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
      channel: 'email',
      destinationType: 'email',
      destination: {},
      status: 'queued',
      ...overrides,
    })
    .returning();
  return { intentId: intent!.id, recipientId: recipient!.id, deliveryId: delivery!.id };
}

describe('requireNotificationDelivery', () => {
  it('loads an existing delivery row', async () => {
    const userId = await seedUser(db, schema, 'DeliveryRequireFound');
    const { deliveryId } = await seedDeliveryChain(userId);

    const delivery = await requireNotificationDelivery(db, deliveryId, 'Email');
    expect(delivery.id).toBe(deliveryId);
  });

  it('throws a channel-scoped error when the delivery does not exist', async () => {
    await expect(requireNotificationDelivery(db, 'does_not_exist', 'Email')).rejects.toThrow(
      /Email notification delivery not found/,
    );
  });
});

describe('activeDeliveryContactPoint', () => {
  it('returns null when the delivery destination has no contact point id', async () => {
    const userId = await seedUser(db, schema, 'DeliveryContactNoDestination');
    const { deliveryId } = await seedDeliveryChain(userId);
    const delivery = await requireNotificationDelivery(db, deliveryId, 'Email');

    expect(await activeDeliveryContactPoint(db, delivery, 'email')).toBeNull();
  });

  it('returns null when the referenced contact point type does not match', async () => {
    const userId = await seedUser(db, schema, 'DeliveryContactTypeMismatch');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: '+17025550100',
      valueNormalized: '+17025550100',
    });
    const { deliveryId } = await seedDeliveryChain(userId, {
      destination: { type: 'phone', contactPointId: point.id },
    });
    const delivery = await requireNotificationDelivery(db, deliveryId, 'Email');

    expect(await activeDeliveryContactPoint(db, delivery, 'email')).toBeNull();
  });

  it('returns null when the referenced contact point is not active', async () => {
    const userId = await seedUser(db, schema, 'DeliveryContactInactive');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'inactive@example.test',
      valueNormalized: 'inactive@example.test',
      status: 'disabled',
    });
    const { deliveryId } = await seedDeliveryChain(userId, {
      destination: { type: 'email', contactPointId: point.id },
    });
    const delivery = await requireNotificationDelivery(db, deliveryId, 'Email');

    expect(await activeDeliveryContactPoint(db, delivery, 'email')).toBeNull();
  });

  it('returns null when the referenced contact point has no verifiedAt', async () => {
    const userId = await seedUser(db, schema, 'DeliveryContactUnverified');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'unverified@example.test',
      valueNormalized: 'unverified@example.test',
      verifiedAt: null,
    });
    const { deliveryId } = await seedDeliveryChain(userId, {
      destination: { type: 'email', contactPointId: point.id },
    });
    const delivery = await requireNotificationDelivery(db, deliveryId, 'Email');

    expect(await activeDeliveryContactPoint(db, delivery, 'email')).toBeNull();
  });

  it('returns the contact point when it is active, type-matched, and verified', async () => {
    const userId = await seedUser(db, schema, 'DeliveryContactActive');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'active@example.test',
      valueNormalized: 'active@example.test',
    });
    const { deliveryId } = await seedDeliveryChain(userId, {
      destination: { type: 'email', contactPointId: point.id },
    });
    const delivery = await requireNotificationDelivery(db, deliveryId, 'Email');

    const found = await activeDeliveryContactPoint(db, delivery, 'email');
    expect(found?.id).toBe(point.id);
  });
});

describe('markDeliverySent', () => {
  it('marks a delivery sent, clearing any prior error and recording provider metadata', async () => {
    const userId = await seedUser(db, schema, 'DeliveryMarkSent');
    const { deliveryId } = await seedDeliveryChain(userId, {
      status: 'failed',
      errorCode: 'email_send_failed',
      errorMessage: 'boom',
    });
    const sentAt = new Date('2026-07-07T17:00:00.000Z');

    const updated = await markDeliverySent(db, deliveryId, {
      sentAt,
      providerMessageId: 'msg_1',
      providerPayload: { ok: true },
    });

    expect(updated).toMatchObject({
      status: 'sent',
      providerMessageId: 'msg_1',
      providerPayload: { ok: true },
      errorCode: null,
      errorMessage: null,
    });
    expect(updated.sentAt).toEqual(sentAt);
  });

  it('defaults providerMessageId and providerPayload when omitted', async () => {
    const userId = await seedUser(db, schema, 'DeliveryMarkSentDefaults');
    const { deliveryId } = await seedDeliveryChain(userId);

    const updated = await markDeliverySent(db, deliveryId, { sentAt: new Date() });

    expect(updated.providerMessageId).toBeNull();
    expect(updated.providerPayload).toEqual({});
  });

  it('throws when the delivery does not exist', async () => {
    await expect(markDeliverySent(db, 'does_not_exist', { sentAt: new Date() })).rejects.toThrow(
      /Failed to update sent notification delivery/,
    );
  });
});

describe('markDeliveryFailed', () => {
  it('marks a delivery failed with the given error code/message', async () => {
    const userId = await seedUser(db, schema, 'DeliveryMarkFailed');
    const { deliveryId } = await seedDeliveryChain(userId);

    const updated = await markDeliveryFailed(db, deliveryId, {
      errorCode: 'email_send_failed',
      errorMessage: 'Email delivery failed',
      providerPayload: { reason: 'bounced' },
    });

    expect(updated).toMatchObject({
      status: 'failed',
      errorCode: 'email_send_failed',
      errorMessage: 'Email delivery failed',
      providerPayload: { reason: 'bounced' },
    });
  });

  it('defaults providerPayload to an empty object when omitted', async () => {
    const userId = await seedUser(db, schema, 'DeliveryMarkFailedDefault');
    const { deliveryId } = await seedDeliveryChain(userId);

    const updated = await markDeliveryFailed(db, deliveryId, {
      errorCode: 'email_send_failed',
      errorMessage: 'Email delivery failed',
    });

    expect(updated.providerPayload).toEqual({});
  });

  it('throws when the delivery does not exist', async () => {
    await expect(
      markDeliveryFailed(db, 'does_not_exist', {
        errorCode: 'email_send_failed',
        errorMessage: 'Email delivery failed',
      }),
    ).rejects.toThrow(/Failed to update failed notification delivery/);
  });
});

describe('disableContactPoint', () => {
  it('marks a contact point disabled, no longer primary, with a disabledAt timestamp', async () => {
    const userId = await seedUser(db, schema, 'DeliveryDisableContactPoint');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: 'dead-token',
      valueNormalized: 'dead-token',
    });
    const now = new Date('2026-07-07T17:00:00.000Z');

    await disableContactPoint(db, point.id, now);

    const [updated] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, point.id));
    expect(updated).toMatchObject({ status: 'disabled', primary: false });
    expect(updated?.disabledAt).toEqual(now);
  });
});
