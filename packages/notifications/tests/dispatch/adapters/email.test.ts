import type * as DbModule from '@docket/db';
import type { Mailer, OutboundMessage } from '@docket/mail';
import { beforeAll, describe, expect, it } from 'vitest';

import { deliverEmailNotification } from '../../../src/dispatch/adapters/email';
import { getMigratedDb } from '../../support/db';
import { seedContactPoint, seedUser } from '../../support/seed';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

/** A capturing {@link Mailer}, optionally scripted to reject. */
function fakeMailer(fail = false): { mailer: Mailer; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  const mailer: Mailer = {
    send: async (message) => {
      if (fail) throw new Error('mailer unavailable');
      sent.push(message);
    },
  };
  return { mailer, sent };
}

async function seedDeliveryChain(userId: string, contactPointId?: string): Promise<string> {
  const [intent] = await db
    .insert(schema.notificationIntent)
    .values({
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['email'],
      subject: 'Subject',
      body: { text: 'Body' },
      createdBy: 'system',
    })
    .returning();
  const [recipient] = await db
    .insert(schema.notificationRecipient)
    .values({
      notificationId: assertDefined(intent).id,
      userId,
      organizationId: null,
      reason: 'explicit',
    })
    .returning();
  const [delivery] = await db
    .insert(schema.notificationDelivery)
    .values({
      notificationId: assertDefined(intent).id,
      recipientId: assertDefined(recipient).id,
      channel: 'email',
      destinationType: 'email',
      destination: contactPointId ? { type: 'email', contactPointId } : {},
      status: 'queued',
    })
    .returning();
  return assertDefined(delivery).id;
}

describe('deliverEmailNotification', () => {
  it('sends through the mailer with html+text and marks the delivery sent', async () => {
    const userId = await seedUser(db, schema, 'AdapterEmailSent');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'recipient@example.test',
      valueNormalized: 'recipient@example.test',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { mailer, sent } = fakeMailer();
    const now = new Date('2026-07-07T17:00:00.000Z');

    const result = await deliverEmailNotification(db, {
      deliveryId,
      subject: 'Hello',
      body: { text: 'Plain text', html: '<p>Rich</p>' },
      now,
      mailer,
    });

    expect(sent).toEqual([
      { to: 'recipient@example.test', subject: 'Hello', html: '<p>Rich</p>', text: 'Plain text' },
    ]);
    expect(result).toMatchObject({ status: 'sent' });
    expect(result.sentAt).toEqual(now);
  });

  it('omits html/text keys the body does not provide', async () => {
    const userId = await seedUser(db, schema, 'AdapterEmailTextOnly');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'text-only@example.test',
      valueNormalized: 'text-only@example.test',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { mailer, sent } = fakeMailer();

    await deliverEmailNotification(db, {
      deliveryId,
      subject: 'Hello',
      body: {},
      now: new Date(),
      mailer,
    });

    expect(sent[0]).toEqual({ to: 'text-only@example.test', subject: 'Hello' });
  });

  it('marks the delivery failed when there is no active verified email contact point', async () => {
    const userId = await seedUser(db, schema, 'AdapterEmailNoContact');
    const deliveryId = await seedDeliveryChain(userId);
    const { mailer, sent } = fakeMailer();

    const result = await deliverEmailNotification(db, {
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      mailer,
    });

    expect(sent).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'email_contact_point_not_found',
      errorMessage: 'Email delivery failed',
    });
  });

  it('marks the delivery failed when the mailer throws', async () => {
    const userId = await seedUser(db, schema, 'AdapterEmailSendFails');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: 'fails@example.test',
      valueNormalized: 'fails@example.test',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { mailer } = fakeMailer(true);

    const result = await deliverEmailNotification(db, {
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      mailer,
    });

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'email_send_failed',
      errorMessage: 'Email delivery failed',
    });
  });
});
