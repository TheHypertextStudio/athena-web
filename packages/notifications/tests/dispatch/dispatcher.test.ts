import type * as DbModule from '@docket/db';
import type { Mailer } from '@docket/mail';
import { PushSendError, type PushSender, type SmsSender } from '@docket/integrations';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { NotificationAudience } from '@docket/notifications';

import {
  dispatchNotificationIntent,
  dispatchPersistedNotificationIntent,
  type DispatchNotificationIntentInput,
} from '../../src/dispatch/dispatcher';
import { configureNotificationTransports } from '../../src/dispatch/transports';
import { getMigratedDb } from '../support/db';
import { addMember, seedContactPoint, seedOrg, seedUser, token } from '../support/seed';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

const failEmails = new Set<string>();
const failPhones = new Set<string>();
const invalidPushTokens = new Set<string>();
const failPushTokens = new Set<string>();
const sentEmails: { to: string; subject: string }[] = [];

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;

  const mailer: Mailer = {
    send: async (message) => {
      if (failEmails.has(message.to)) throw new Error('mailer unavailable');
      sentEmails.push({ to: message.to, subject: message.subject });
    },
  };
  const sms: SmsSender = {
    send: async (message) => {
      if (failPhones.has(message.to)) throw new Error('sms provider unavailable');
      return { ...message, id: `sms_${token()}`, sentAt: '2026-07-07T17:00:00.000Z' };
    },
  };
  const push: PushSender = {
    send: async (message) => {
      if (invalidPushTokens.has(message.token)) {
        throw new PushSendError('invalid_token', 'gone');
      }
      if (failPushTokens.has(message.token)) throw new Error('push provider unavailable');
      return { ...message, id: `push_${token()}`, sentAt: '2026-07-07T17:00:00.000Z' };
    },
  };
  configureNotificationTransports({ mailer: () => mailer, sms: () => sms, push: () => push });
});

/** Build a minimal valid create-intent input for a single-user audience. */
function baseInput(
  userId: string,
  over: Partial<DispatchNotificationIntentInput> = {},
): DispatchNotificationIntentInput {
  return {
    senderType: 'system',
    category: 'service_announcement',
    priority: 'normal',
    audience: { type: 'user', userId },
    channels: ['web'],
    subject: 'Subject',
    body: { text: 'Body' },
    replyPolicy: 'none',
    createdBy: 'system',
    ...over,
  };
}

describe('dispatchNotificationIntent — web channel', () => {
  it('persists the intent graph and projects a web inbox row', async () => {
    const userId = await seedUser(db, schema, 'DispatcherWebRecipient');

    const result = await dispatchNotificationIntent(db, baseInput(userId, { subject: 'Hi' }));

    expect(result).toMatchObject({
      status: 'sent',
      idempotent: false,
      recipients: [{ userId, organizationId: null, reason: 'explicit' }],
      deliveries: [{ channel: 'web', destinationType: 'in_app', status: 'sent' }],
      webNotifications: [{ userId, organizationId: null, type: 'service_announcement' }],
    });

    const intents = await db
      .select()
      .from(schema.notificationIntent)
      .where(eq(schema.notificationIntent.id, result.intentId));
    expect(intents).toMatchObject([{ id: result.intentId, status: 'sent' }]);
  });

  it('works without an idempotency key (creates a fresh intent every call)', async () => {
    const userId = await seedUser(db, schema, 'DispatcherNoIdempotencyKey');
    const first = await dispatchNotificationIntent(db, baseInput(userId));
    const second = await dispatchNotificationIntent(db, baseInput(userId));
    expect(second.intentId).not.toBe(first.intentId);
    expect(second.idempotent).toBe(false);
  });

  it('uses idempotency keys to avoid duplicate recipients, deliveries, and inbox rows', async () => {
    const userId = await seedUser(db, schema, 'DispatcherIdempotentRecipient');
    const idempotencyKey = `dispatcher-idempotent-${token()}`;
    const input = baseInput(userId, { idempotencyKey });

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
  });

  it('persists a scheduledAt instant when provided', async () => {
    const userId = await seedUser(db, schema, 'DispatcherScheduledAt');
    const scheduledAt = '2026-08-01T12:00:00.000Z';

    const result = await dispatchNotificationIntent(db, baseInput(userId, { scheduledAt }));

    const [intent] = await db
      .select()
      .from(schema.notificationIntent)
      .where(eq(schema.notificationIntent.id, result.intentId));
    expect(intent?.scheduledAt).toEqual(new Date(scheduledAt));
  });

  it('threads an authenticated webUrl into the inbox projection', async () => {
    const userId = await seedUser(db, schema, 'DispatcherWebUrl');
    const result = await dispatchNotificationIntent(
      db,
      baseInput(userId, { webUrl: 'https://app.example.com/x' }),
    );
    expect(result.webNotifications[0]?.body).toMatchObject({
      url: 'https://app.example.com/x',
    });
  });

  it('produces a sent status with no deliveries when the audience expands to no one', async () => {
    const orgId = await seedOrg(db, schema);
    const result = await dispatchNotificationIntent(
      db,
      baseInput('unused', {
        audience: NotificationAudience.parse({ type: 'organization', organizationId: orgId }),
        subject: 'No members yet',
      }),
    );

    expect(result).toMatchObject({
      status: 'sent',
      recipients: [],
      deliveries: [],
      webNotifications: [],
    });
  });

  it('fans out to every active member of an organization audience', async () => {
    const orgId = await seedOrg(db, schema);
    const firstUserId = await seedUser(db, schema, 'DispatcherOrgFirst');
    const secondUserId = await seedUser(db, schema, 'DispatcherOrgSecond');
    await addMember(db, schema, orgId, firstUserId, 'member', 'active');
    await addMember(db, schema, orgId, secondUserId, 'member', 'active');

    const result = await dispatchNotificationIntent(
      db,
      baseInput('unused', {
        audience: NotificationAudience.parse({ type: 'organization', organizationId: orgId }),
        subject: 'Org-wide notice',
      }),
    );

    expect(result.recipients).toHaveLength(2);
    expect(result.deliveries).toHaveLength(2);
    expect(result.webNotifications).toHaveLength(2);
  });
});

describe('dispatchNotificationIntent — policy rejection', () => {
  it('throws a clear error listing every denial reason', async () => {
    const userId = await seedUser(db, schema, 'DispatcherPolicyRejected');
    await expect(
      dispatchNotificationIntent(
        db,
        baseInput(userId, { category: 'marketing', channels: ['email'] }),
      ),
    ).rejects.toThrow(/Notification intent rejected: marketing_requires_dedicated_consent_surface/);
  });

  it('rejects an all_users audience from a non-staff sender', async () => {
    await expect(
      dispatchNotificationIntent(db, {
        senderType: 'system',
        category: 'service_announcement',
        priority: 'normal',
        audience: { type: 'all_users' },
        channels: ['web'],
        subject: 'Broadcast',
        body: { text: 'Body' },
        replyPolicy: 'none',
        createdBy: 'system',
      }),
    ).rejects.toThrow(/all_users_requires_staff_sender/);
  });
});

describe('dispatchNotificationIntent — email channel', () => {
  it('sends email, marks the delivery sent, and keeps web unread state canonical', async () => {
    const userId = await seedUser(db, schema, 'DispatcherEmailRecipient');
    const email = `dispatcher-email-${token()}@example.test`;
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: email,
      valueNormalized: email,
    });
    const before = sentEmails.length;

    const result = await dispatchNotificationIntent(
      db,
      baseInput(userId, { channels: ['web', 'email'], subject: 'Scheduled maintenance' }),
    );

    expect(sentEmails).toHaveLength(before + 1);
    expect(sentEmails.at(-1)).toMatchObject({ to: email, subject: 'Scheduled maintenance' });
    expect(result.status).toBe('sent');
    expect(result.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'web', status: 'sent' }),
        expect.objectContaining({ channel: 'email', status: 'sent' }),
      ]),
    );
  });

  it('suppresses email without a verified contact point and does not send mail', async () => {
    const userId = await seedUser(db, schema, 'DispatcherEmailNoContact');
    const before = sentEmails.length;

    const result = await dispatchNotificationIntent(db, baseInput(userId, { channels: ['email'] }));

    expect(sentEmails).toHaveLength(before);
    expect(result.deliveries).toMatchObject([{ channel: 'email', status: 'suppressed' }]);
    expect(result.recipients[0]?.suppressions).toEqual([
      { reason: 'no_verified_contact_point', channel: 'email' },
    ]);
  });

  it('marks the intent partially_failed when one of several channels fails to send', async () => {
    const userId = await seedUser(db, schema, 'DispatcherEmailPartialFailure');
    const email = `partial-fail-${token()}@example.test`;
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: email,
      valueNormalized: email,
    });
    failEmails.add(email);

    try {
      const result = await dispatchNotificationIntent(
        db,
        baseInput(userId, { channels: ['web', 'email'] }),
      );
      expect(result.status).toBe('partially_failed');
      expect(result.deliveries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ channel: 'web', status: 'sent' }),
          expect.objectContaining({
            channel: 'email',
            status: 'failed',
            errorCode: 'email_send_failed',
          }),
        ]),
      );
    } finally {
      failEmails.delete(email);
    }
  });

  it('marks the intent failed when the only channel fails to send', async () => {
    const userId = await seedUser(db, schema, 'DispatcherEmailTotalFailure');
    const email = `total-fail-${token()}@example.test`;
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: email,
      valueNormalized: email,
    });
    failEmails.add(email);

    try {
      const result = await dispatchNotificationIntent(
        db,
        baseInput(userId, { channels: ['email'] }),
      );
      expect(result.status).toBe('failed');
    } finally {
      failEmails.delete(email);
    }
  });
});

describe('dispatchNotificationIntent — SMS and push channels', () => {
  it('sends SMS and push and marks deliveries sent', async () => {
    const userId = await seedUser(db, schema, 'DispatcherSmsPushRecipient');
    const phone = `+1702555${Math.floor(1000 + Math.random() * 8999)}`;
    const pushToken = `push-token-${token()}`;
    await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: phone,
      valueNormalized: phone,
    });
    await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: pushToken,
      valueNormalized: pushToken,
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { sms: true, push: true } },
    });

    const result = await dispatchNotificationIntent(
      db,
      baseInput(userId, { channels: ['sms', 'push'] }),
    );

    expect(result.status).toBe('sent');
    expect(result.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'sms', status: 'sent' }),
        expect.objectContaining({ channel: 'push', status: 'sent' }),
      ]),
    );
  });

  it('disables the push contact point and marks delivery failed on an invalid token', async () => {
    const userId = await seedUser(db, schema, 'DispatcherPushInvalidToken');
    const pushToken = `invalid-push-${token()}`;
    await seedContactPoint(db, schema, userId, {
      type: 'push_token',
      value: pushToken,
      valueNormalized: pushToken,
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { push: true } },
    });
    invalidPushTokens.add(pushToken);

    try {
      const result = await dispatchNotificationIntent(
        db,
        baseInput(userId, { channels: ['push'] }),
      );
      expect(result.deliveries).toMatchObject([
        { channel: 'push', status: 'failed', errorCode: 'push_invalid_token' },
      ]);

      const [point] = await db
        .select()
        .from(schema.contactPoint)
        .where(
          and(eq(schema.contactPoint.userId, userId), eq(schema.contactPoint.type, 'push_token')),
        );
      expect(point?.status).toBe('disabled');
    } finally {
      invalidPushTokens.delete(pushToken);
    }
  });

  it('suppresses SMS without a verified contact point', async () => {
    const userId = await seedUser(db, schema, 'DispatcherSmsNoContact');
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { sms: true } },
    });

    const result = await dispatchNotificationIntent(db, baseInput(userId, { channels: ['sms'] }));

    expect(result.deliveries).toMatchObject([
      { channel: 'sms', destinationType: 'phone', status: 'suppressed' },
    ]);
  });

  it('suppresses push without a verified contact point', async () => {
    const userId = await seedUser(db, schema, 'DispatcherPushNoContact');
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { push: true } },
    });

    const result = await dispatchNotificationIntent(db, baseInput(userId, { channels: ['push'] }));

    expect(result.deliveries).toMatchObject([
      { channel: 'push', destinationType: 'push_token', status: 'suppressed' },
    ]);
  });

  it('marks SMS delivery failed on a generic provider error', async () => {
    const userId = await seedUser(db, schema, 'DispatcherSmsProviderError');
    const phone = `+1702555${Math.floor(1000 + Math.random() * 8999)}`;
    await seedContactPoint(db, schema, userId, {
      type: 'phone',
      value: phone,
      valueNormalized: phone,
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { sms: true } },
    });
    failPhones.add(phone);

    try {
      const result = await dispatchNotificationIntent(db, baseInput(userId, { channels: ['sms'] }));
      expect(result.deliveries).toMatchObject([
        { channel: 'sms', status: 'failed', errorCode: 'sms_send_failed' },
      ]);
    } finally {
      failPhones.delete(phone);
    }
  });
});

describe('dispatchNotificationIntent — quiet hours', () => {
  it('delays external delivery during quiet hours, leaving the delivery queued', async () => {
    const userId = await seedUser(db, schema, 'DispatcherQuietHoursDelay');
    const email = `quiet-hours-${token()}@example.test`;
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: email,
      valueNormalized: email,
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      timezone: 'UTC',
      quietHours: {
        enabled: true,
        start: '00:00',
        end: '00:00',
        days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      },
      categories: { workflow: { email: true } },
    });
    const before = sentEmails.length;

    const result = await dispatchNotificationIntent(
      db,
      baseInput(userId, {
        category: 'workflow',
        channels: ['email'],
        now: new Date('2026-07-06T12:00:00.000Z'),
      }),
    );

    expect(sentEmails).toHaveLength(before);
    expect(result.deliveries).toMatchObject([{ channel: 'email', status: 'queued' }]);
    expect(result.recipients[0]?.suppressions).toEqual([
      { reason: 'quiet_hours', channel: 'email', detail: 'Held by quiet hours' },
    ]);
  });
});

describe('dispatchPersistedNotificationIntent', () => {
  it('returns the already-dispatched result when recipients already exist for the intent', async () => {
    const userId = await seedUser(db, schema, 'DispatcherPersistedTwice');
    const [intent] = await db
      .insert(schema.notificationIntent)
      .values({
        senderType: 'system',
        category: 'service_announcement',
        priority: 'normal',
        audience: { type: 'user', userId },
        channels: ['web'],
        subject: 'Persisted',
        body: { text: 'Body' },
        status: 'sending',
        createdBy: 'system',
      })
      .returning();

    const first = await dispatchPersistedNotificationIntent(db, intent!);
    expect(first.recipients).toHaveLength(1);

    const second = await dispatchPersistedNotificationIntent(db, intent!);
    expect(second.idempotent).toBe(false);
    expect(second.recipients).toHaveLength(1);
    expect(second.deliveries).toHaveLength(1);
    expect(second.intentId).toBe(intent!.id);
  });

  it('applies skip_user_preferences mode, ignoring an explicit channel opt-out', async () => {
    const userId = await seedUser(db, schema, 'DispatcherSkipPreferences');
    const email = `skip-mode-${token()}@example.test`;
    await seedContactPoint(db, schema, userId, {
      type: 'email',
      value: email,
      valueNormalized: email,
    });
    await db.insert(schema.notificationPreference).values({
      userId,
      categories: { service_announcement: { email: false } },
    });

    const result = await dispatchNotificationIntent(
      db,
      baseInput(userId, { channels: ['email'], preferenceMode: 'skip_user_preferences' }),
    );

    expect(result.deliveries).toMatchObject([{ channel: 'email', status: 'sent' }]);
  });
});
