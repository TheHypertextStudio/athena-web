import { describe, expect, it } from 'vitest';

import {
  ContactPointCreate,
  ContactPointOut,
  NotificationAudience,
  NotificationDeliveryOut,
  NotificationInboundEventOut,
  NotificationIntentCreate,
  NotificationIntentOut,
  NotificationPreferencePatch,
  NotificationPreferenceOut,
  NotificationRecipientOut,
} from '../src';

/** A canonical valid 26-char Crockford ULID, reused across DTO fixtures. */
const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
/** A second distinct valid ULID. */
const ID2 = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

describe('notification service DTOs', () => {
  it('parses a service-announcement create request with web + email channels', () => {
    const parsed = NotificationIntentCreate.parse({
      senderType: 'staff',
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'user', userId: 'user_123' },
      channels: ['web', 'email'],
      subject: 'Scheduled maintenance tonight',
      body: {
        text: 'Docket will be briefly unavailable tonight.',
        html: '<p>Docket will be briefly unavailable tonight.</p>',
      },
      scheduledAt: '2026-07-07T05:00:00.000Z',
      replyPolicy: 'staff_inbox',
      idempotencyKey: 'maint-2026-07-06',
    });

    expect(parsed.channels).toEqual(['web', 'email']);
    expect(parsed.audience).toEqual({ type: 'user', userId: 'user_123' });
  });

  it('rejects an intent with no requested channels or message body', () => {
    const result = NotificationIntentCreate.safeParse({
      senderType: 'system',
      category: 'security',
      priority: 'urgent',
      audience: { type: 'user', userId: 'user_123' },
      channels: [],
      subject: 'Security notice',
      body: {},
      replyPolicy: 'none',
    });

    expect(result.success).toBe(false);
  });

  it('parses every supported audience shape', () => {
    expect(NotificationAudience.parse({ type: 'user', userId: 'user_123' })).toEqual({
      type: 'user',
      userId: 'user_123',
    });
    expect(NotificationAudience.parse({ type: 'users', userIds: ['user_1', 'user_2'] })).toEqual({
      type: 'users',
      userIds: ['user_1', 'user_2'],
    });
    expect(NotificationAudience.parse({ type: 'organization', organizationId: ID })).toEqual({
      type: 'organization',
      organizationId: ID,
    });
    expect(NotificationAudience.parse({ type: 'all_users' })).toEqual({ type: 'all_users' });
    expect(NotificationAudience.parse({ type: 'segment', segment: 'billing_admins' })).toEqual({
      type: 'segment',
      segment: 'billing_admins',
    });
  });

  it('parses intent, recipient, delivery, and inbound-event outputs', () => {
    const intent = NotificationIntentOut.parse({
      id: ID,
      senderType: 'staff',
      senderId: 'staff_123',
      organizationId: null,
      category: 'service_announcement',
      priority: 'normal',
      audience: { type: 'all_users' },
      channels: ['web', 'email'],
      subject: 'Scheduled maintenance tonight',
      body: { text: 'Maintenance tonight.' },
      replyPolicy: 'staff_inbox',
      status: 'scheduled',
      scheduledAt: '2026-07-07T05:00:00.000Z',
      createdAt: '2026-07-06T19:00:00.000Z',
      createdBy: 'staff_123',
    });
    expect(intent.status).toBe('scheduled');

    const recipient = NotificationRecipientOut.parse({
      id: ID2,
      notificationId: ID,
      userId: 'user_123',
      organizationId: null,
      reason: 'segment_match',
      suppressions: [{ reason: 'quiet_hours', channel: 'email', detail: 'Held until 08:00' }],
      createdAt: '2026-07-06T19:00:00.000Z',
    });
    expect(recipient.suppressions[0]?.reason).toBe('quiet_hours');

    const delivery = NotificationDeliveryOut.parse({
      id: ID2,
      notificationId: ID,
      recipientId: ID2,
      channel: 'email',
      destination: { type: 'email', valueMasked: 'a***@example.com', contactPointId: ID },
      status: 'sent',
      providerMessageId: 'provider_1',
      errorCode: null,
      errorMessage: null,
      sentAt: '2026-07-06T19:00:01.000Z',
      deliveredAt: null,
      readAt: null,
      actedAt: null,
    });
    expect(delivery.destination.type).toBe('email');

    const inbound = NotificationInboundEventOut.parse({
      id: ID2,
      notificationId: ID,
      deliveryId: delivery.id,
      channel: 'email',
      kind: 'delivered',
      from: null,
      payload: { provider: 'mailpit' },
      receivedAt: '2026-07-06T19:00:02.000Z',
    });
    expect(inbound.kind).toBe('delivered');
  });

  it('parses preference and contact-point DTOs', () => {
    const patch = NotificationPreferencePatch.parse({
      timezone: 'America/Los_Angeles',
      quietHours: {
        enabled: true,
        start: '18:00',
        end: '08:00',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        allowUrgent: true,
      },
      categories: {
        service_announcement: { web: true, email: false, sms: false, push: false },
        workflow: { web: true, email: false, push: true },
      },
      organizations: {
        [ID]: {
          workflow: { web: true, email: true, sms: false, push: true },
        },
      },
    });
    expect(patch.quietHours?.start).toBe('18:00');

    const preference = NotificationPreferenceOut.parse({
      userId: 'user_123',
      timezone: 'America/Los_Angeles',
      quietHours: patch.quietHours,
      categories: {
        security: { web: true, email: true, sms: true, push: true, locked: true },
      },
      organizations: {},
      updatedAt: '2026-07-06T19:00:00.000Z',
    });
    expect(preference.categories['security']?.locked).toBe(true);

    expect(ContactPointCreate.parse({ type: 'phone', value: '+17025550123' })).toEqual({
      type: 'phone',
      value: '+17025550123',
    });

    const contactPoint = ContactPointOut.parse({
      id: ID,
      userId: 'user_123',
      type: 'email',
      valueMasked: 'a***@example.com',
      status: 'active',
      primary: true,
      verifiedAt: '2026-07-06T19:00:00.000Z',
      disabledAt: null,
      createdAt: '2026-07-06T19:00:00.000Z',
    });
    expect(contactPoint.primary).toBe(true);
  });
});
