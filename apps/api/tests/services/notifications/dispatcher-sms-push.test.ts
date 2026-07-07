import type * as DbModule from '@docket/db';
import type { CapturePushSender, CaptureSmsSender } from '@docket/integrations';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { dispatchNotificationIntent } from '../../../src/services/notifications/dispatcher';
import { recordNotificationProviderEvent } from '../../../src/services/notifications/inbound';
import { getDb, one, seedUserWithHub } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

function key(name: string): string {
  return `${name}-${Math.random().toString(36).slice(2)}`;
}

describe('dispatchNotificationIntent — SMS and push channels', () => {
  it('sends SMS and push through capture senders and marks deliveries sent', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherSmsPushRecipient');
    const phone = await seedContactPoint(userId, {
      type: 'phone',
      value: '+17025550123',
      valueMasked: '+1******0123',
    });
    const push = await seedContactPoint(userId, {
      type: 'push_token',
      value: 'push-token-1',
      valueMasked: 'push...en-1',
    });
    await optIntoServiceAnnouncementChannels(userId, { sms: true, push: true });
    const smsOutbox = await captureSmsOutbox();
    const pushOutbox = await capturePushOutbox();
    const beforeSms = smsOutbox.length;
    const beforePush = pushOutbox.length;

    const result = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['sms', 'push'],
      subject: 'Scheduled maintenance',
      body: { text: 'Maintenance starts at 9 PM.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-sms-push'),
    });

    expect(smsOutbox).toHaveLength(beforeSms + 1);
    expect(smsOutbox.at(-1)).toMatchObject({
      to: '+17025550123',
      body: 'Scheduled maintenance\n\nMaintenance starts at 9 PM.',
    });
    expect(pushOutbox).toHaveLength(beforePush + 1);
    expect(pushOutbox.at(-1)).toMatchObject({
      token: 'push-token-1',
      title: 'Scheduled maintenance',
      body: 'Maintenance starts at 9 PM.',
      data: {
        notificationId: result.intentId,
      },
    });
    expect(result.status).toBe('sent');
    expect(result.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'sms',
          destinationType: 'phone',
          status: 'sent',
          destination: {
            type: 'phone',
            contactPointId: phone.id,
            valueMasked: '+1******0123',
          },
        }),
        expect.objectContaining({
          channel: 'push',
          destinationType: 'push_token',
          status: 'sent',
          destination: {
            type: 'push_token',
            contactPointId: push.id,
            valueMasked: 'push...en-1',
          },
        }),
      ]),
    );
  });

  it('honors SMS STOP events by suppressing later SMS sends to that phone contact point', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherSmsStopRecipient');
    const phone = await seedContactPoint(userId, {
      type: 'phone',
      value: '+17025550999',
      valueMasked: '+1******0999',
    });
    await optIntoServiceAnnouncementChannels(userId, { sms: true });
    const smsOutbox = await captureSmsOutbox();
    const before = smsOutbox.length;

    const first = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['sms'],
      subject: 'Before STOP',
      body: { text: 'This one sends.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-sms-before-stop'),
    });
    const smsDelivery = one(first.deliveries.filter((delivery) => delivery.channel === 'sms'));

    await recordNotificationProviderEvent(db, {
      providerEventId: key('sms-stop'),
      channel: 'sms',
      kind: 'unsubscribed',
      notificationId: first.intentId,
      deliveryId: smsDelivery.id,
      from: '+17025550999',
      payload: { event: 'stop' },
      contactPointStatus: 'unsubscribed',
    });

    const second = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['sms'],
      subject: 'After STOP',
      body: { text: 'This one should not send.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-sms-after-stop'),
    });

    expect(smsOutbox).toHaveLength(before + 1);
    expect(second.deliveries).toMatchObject([
      {
        channel: 'sms',
        destinationType: 'phone',
        status: 'suppressed',
        destination: {
          type: 'phone',
          contactPointId: phone.id,
          valueMasked: '+1******0999',
        },
      },
    ]);

    const [updatedPhone] = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, phone.id));
    expect(updatedPhone?.status).toBe('unsubscribed');
  });

  it('suppresses push when the token has been disabled by a provider callback', async () => {
    const userId = await seedUserWithHub(db, schema, 'DispatcherPushDisabledRecipient');
    const point = await seedContactPoint(userId, {
      type: 'push_token',
      value: 'dead-push-token',
      valueMasked: 'dead...oken',
      status: 'disabled',
    });
    await optIntoServiceAnnouncementChannels(userId, { push: true });
    const pushOutbox = await capturePushOutbox();
    const before = pushOutbox.length;

    const result = await dispatchNotificationIntent(db, {
      senderType: 'system',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId },
      channels: ['push'],
      subject: 'Disabled token',
      body: { text: 'No push should be sent.' },
      replyPolicy: 'none',
      createdBy: 'system',
      idempotencyKey: key('dispatcher-push-disabled'),
    });

    expect(pushOutbox).toHaveLength(before);
    expect(result.deliveries).toMatchObject([
      {
        channel: 'push',
        destinationType: 'push_token',
        status: 'suppressed',
      },
    ]);
    expect(result.recipients[0]?.suppressions).toEqual([
      { reason: 'no_verified_contact_point', channel: 'push' },
    ]);
    expect(point.id).toBeDefined();
  });
});

async function captureSmsOutbox(): Promise<CaptureSmsSender['outbox']> {
  const [{ CaptureSmsSender }, { getContainer }] = await Promise.all([
    import('@docket/integrations'),
    import('../../../src/container'),
  ]);
  const sms = getContainer().sms;
  if (!(sms instanceof CaptureSmsSender))
    throw new Error('expected the capture SMS sender in tests');
  return sms.outbox;
}

async function capturePushOutbox(): Promise<CapturePushSender['outbox']> {
  const [{ CapturePushSender }, { getContainer }] = await Promise.all([
    import('@docket/integrations'),
    import('../../../src/container'),
  ]);
  const push = getContainer().push;
  if (!(push instanceof CapturePushSender)) {
    throw new Error('expected the capture push sender in tests');
  }
  return push.outbox;
}

async function seedContactPoint(
  userId: string,
  input: {
    readonly type: 'phone' | 'push_token';
    readonly value: string;
    readonly valueMasked: string;
    readonly status?: 'active' | 'disabled';
  },
): Promise<{ readonly id: string }> {
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: input.type,
        value: input.value,
        valueNormalized: input.value,
        valueMasked: input.valueMasked,
        status: input.status ?? 'active',
        primary: true,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
      })
      .returning({ id: schema.contactPoint.id }),
  );
}

async function optIntoServiceAnnouncementChannels(
  userId: string,
  channels: { readonly sms?: boolean; readonly push?: boolean },
): Promise<void> {
  await db.insert(schema.notificationPreference).values({
    userId,
    categories: {
      service_announcement: channels,
    },
    organizations: {},
  });
}
