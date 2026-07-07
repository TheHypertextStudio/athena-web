import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { dispatchSystemUserNotification } from '../../../src/services/notifications/system';
import { getDb, one, seedUserWithHub } from '../../routes/harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('notification inbound service', () => {
  it('records an email bounce, marks the delivery bounced, and marks the contact point bounced', async () => {
    const { recordNotificationProviderEvent, normalizeEmailProviderPayload } =
      await import('../../../src/services/notifications/inbound');
    const { userId, deliveryId, contactPointId } = await seedEmailDelivery('InboundEmailBounce');

    const inbound = await recordNotificationProviderEvent(
      db,
      normalizeEmailProviderPayload({
        eventId: `email-bounce-${userId}`,
        event: 'bounced',
        deliveryId,
        recipient: 'bounce@example.test',
      }),
    );

    expect(inbound).toMatchObject({
      channel: 'email',
      kind: 'bounced',
      deliveryId,
    });
    const [delivery] = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.id, deliveryId));
    expect(delivery).toMatchObject({ status: 'bounced' });
    const [point] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, contactPointId));
    expect(point).toMatchObject({ status: 'bounced' });
  });

  it('deduplicates provider event ids stored in the normalized payload', async () => {
    const { recordNotificationProviderEvent, normalizeEmailProviderPayload } =
      await import('../../../src/services/notifications/inbound');
    const { userId, deliveryId } = await seedEmailDelivery('InboundEmailDuplicate');
    const input = normalizeEmailProviderPayload({
      eventId: `email-open-${userId}`,
      event: 'opened',
      deliveryId,
    });

    const first = await recordNotificationProviderEvent(db, input);
    const second = await recordNotificationProviderEvent(db, input);

    expect(second.id).toBe(first.id);
    const rows = await db
      .select()
      .from(schema.notificationInboundEvent)
      .where(eq(schema.notificationInboundEvent.deliveryId, deliveryId));
    expect(rows.filter((row) => row.kind === 'opened')).toHaveLength(1);
  });

  it('captures SMS STOP with unknown correlation without attaching it to a delivery', async () => {
    const { recordNotificationProviderEvent, normalizeSmsProviderPayload } =
      await import('../../../src/services/notifications/inbound');

    const inbound = await recordNotificationProviderEvent(
      db,
      normalizeSmsProviderPayload({
        eventId: 'sms-stop-unknown-correlation',
        event: 'STOP',
        from: '+17025550123',
        body: 'STOP',
        correlationToken: 'missing-delivery',
      }),
    );

    expect(inbound).toMatchObject({
      channel: 'sms',
      kind: 'unsubscribed',
      notificationId: null,
      deliveryId: null,
      from: '+17025550123',
    });
  });

  it('records push invalid-token callbacks as failed delivery attempts and disables the token', async () => {
    const { recordNotificationProviderEvent, normalizePushProviderPayload } =
      await import('../../../src/services/notifications/inbound');
    const userId = await seedUserWithHub(db, schema, 'InboundPushInvalid');
    const point = await seedContactPoint(userId, {
      type: 'push_token',
      value: 'push-token-1',
      valueNormalized: 'push-token-1',
      valueMasked: 'push...en-1',
    });
    const result = await dispatchSystemUserNotification(db, {
      userId,
      category: 'account',
      priority: 'normal',
      channels: ['push'],
      subject: 'Push test',
      body: { text: 'Push test' },
    });
    const delivery = one(result.deliveries.filter((row) => row.channel === 'push'));

    const inbound = await recordNotificationProviderEvent(
      db,
      normalizePushProviderPayload({
        eventId: `push-invalid-${userId}`,
        event: 'invalid_token',
        deliveryId: delivery.id,
      }),
    );

    expect(inbound).toMatchObject({ channel: 'push', kind: 'action', deliveryId: delivery.id });
    const [updatedDelivery] = await db
      .select()
      .from(schema.notificationDelivery)
      .where(eq(schema.notificationDelivery.id, delivery.id));
    expect(updatedDelivery).toMatchObject({ status: 'failed' });
    const [updatedPoint] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, point.id));
    expect(updatedPoint).toMatchObject({ status: 'disabled' });
  });
});

async function seedEmailDelivery(name: string): Promise<{
  readonly userId: string;
  readonly deliveryId: string;
  readonly contactPointId: string;
}> {
  const userId = await seedUserWithHub(db, schema, name);
  const point = await seedContactPoint(userId, {
    type: 'email',
    value: `${name.toLowerCase()}@example.test`,
    valueNormalized: `${name.toLowerCase()}@example.test`,
    valueMasked: `${name.slice(0, 1).toLowerCase()}***@example.test`,
  });
  const result = await dispatchSystemUserNotification(db, {
    userId,
    email: `${name.toLowerCase()}@example.test`,
    category: 'account',
    priority: 'normal',
    channels: ['email'],
    subject: `${name} subject`,
    body: { text: `${name} body` },
  });
  return {
    userId,
    deliveryId: one(result.deliveries.filter((row) => row.channel === 'email')).id,
    contactPointId: point.id,
  };
}

async function seedContactPoint(
  userId: string,
  overrides: Partial<typeof schema.contactPoint.$inferInsert>,
): Promise<{ readonly id: string }> {
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'email',
        value: 'inbound@example.test',
        valueNormalized: 'inbound@example.test',
        valueMasked: 'i***@example.test',
        status: 'active',
        primary: true,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
        ...overrides,
      })
      .returning({ id: schema.contactPoint.id }),
  );
}
