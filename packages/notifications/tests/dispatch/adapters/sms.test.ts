import type * as DbModule from '@docket/db';
import type { OutboundSms, SentSms, SmsSender } from '@docket/integrations';
import { beforeAll, describe, expect, it } from 'vitest';

import { deliverSmsNotification } from '../../../src/dispatch/adapters/sms';
import { getMigratedDb } from '../../support/db';
import { seedContactPoint, seedUser } from '../../support/seed';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

/** A capturing {@link SmsSender}, optionally scripted to reject. */
function fakeSms(fail = false): { sms: SmsSender; sent: OutboundSms[] } {
  const sent: OutboundSms[] = [];
  const sms: SmsSender = {
    send: async (message) => {
      if (fail) throw new Error('sms provider unavailable');
      sent.push(message);
      const result: SentSms = { ...message, id: 'sms_1', sentAt: '2026-07-07T17:00:00.000Z' };
      return result;
    },
  };
  return { sms, sent };
}

async function seedDeliveryChain(userId: string, contactPointId?: string): Promise<string> {
  const [intent] = await db
    .insert(schema.notificationIntent)
    .values({
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['sms'],
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
      channel: 'sms',
      destinationType: 'phone',
      destination: contactPointId ? { type: 'phone', contactPointId } : {},
      status: 'queued',
    })
    .returning();
  return assertDefined(delivery).id;
}

describe('deliverSmsNotification', () => {
  it('sends "subject\\n\\ntext" through the sender and marks the delivery sent', async () => {
    const userId = await seedUser(db, schema, 'AdapterSmsSent');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: '+17025550123',
      valueNormalized: '+17025550123',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { sms, sent } = fakeSms();

    const result = await deliverSmsNotification(db, {
      deliveryId,
      subject: 'Scheduled maintenance',
      body: { text: 'Starts at 9pm.' },
      now: new Date('2026-07-07T17:00:00.000Z'),
      sms,
    });

    expect(sent).toEqual([{ to: '+17025550123', body: 'Scheduled maintenance\n\nStarts at 9pm.' }]);
    expect(result).toMatchObject({
      status: 'sent',
      providerMessageId: 'sms_1',
      providerPayload: { sentAt: '2026-07-07T17:00:00.000Z' },
    });
  });

  it('sends the subject alone when the body has no text', async () => {
    const userId = await seedUser(db, schema, 'AdapterSmsSubjectOnly');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: '+17025550124',
      valueNormalized: '+17025550124',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { sms, sent } = fakeSms();

    await deliverSmsNotification(db, {
      deliveryId,
      subject: 'Just the subject',
      body: {},
      now: new Date(),
      sms,
    });

    expect(sent[0]?.body).toBe('Just the subject');
  });

  it('sends the subject alone when the body text is only whitespace', async () => {
    const userId = await seedUser(db, schema, 'AdapterSmsBlankText');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: '+17025550125',
      valueNormalized: '+17025550125',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { sms, sent } = fakeSms();

    await deliverSmsNotification(db, {
      deliveryId,
      subject: 'Whitespace body',
      body: { text: '   ' },
      now: new Date(),
      sms,
    });

    expect(sent[0]?.body).toBe('Whitespace body');
  });

  it('marks the delivery failed when there is no active verified phone contact point', async () => {
    const userId = await seedUser(db, schema, 'AdapterSmsNoContact');
    const deliveryId = await seedDeliveryChain(userId);
    const { sms, sent } = fakeSms();

    const result = await deliverSmsNotification(db, {
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      sms,
    });

    expect(sent).toHaveLength(0);
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'sms_contact_point_not_found',
      errorMessage: 'SMS delivery failed',
    });
  });

  it('marks the delivery failed when the sender throws', async () => {
    const userId = await seedUser(db, schema, 'AdapterSmsSendFails');
    const point = await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: '+17025550126',
      valueNormalized: '+17025550126',
    });
    const deliveryId = await seedDeliveryChain(userId, point.id);
    const { sms } = fakeSms(true);

    const result = await deliverSmsNotification(db, {
      deliveryId,
      subject: 'Hello',
      body: { text: 'Body' },
      now: new Date(),
      sms,
    });

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'sms_send_failed',
      errorMessage: 'SMS delivery failed',
    });
  });
});
