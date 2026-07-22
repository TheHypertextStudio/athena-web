import type { z } from 'zod';

import type {
  ContactPointCreate,
  ContactPointOut,
  NotificationAudience,
  NotificationDeliveryOut,
  NotificationInboundEventOut,
  NotificationIntentCreate,
  NotificationIntentOut,
  NotificationPreferenceOut,
  NotificationPreferencePatch,
  NotificationRecipientOut,
} from '../schemas';

/** Stable ids and principals reused by notification-domain fixtures. */
export const notificationFixtureIds = {
  notificationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  recipientId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
  contactPointId: '01D78XYFJ1PRM1WPBCBT3VHMNV',
  userId: 'user_123',
  staffId: 'staff_123',
  organizationId: '01F8MECHZX3TBDSZ7XRADM79XV',
} as const;

/** Reusable valid audience examples for every supported selector shape. */
export const notificationAudienceFixtures = {
  user: { type: 'user', userId: notificationFixtureIds.userId },
  users: { type: 'users', userIds: ['user_1', 'user_2'] },
  organization: {
    type: 'organization',
    organizationId: notificationFixtureIds.organizationId,
  },
  allUsers: { type: 'all_users' },
  segment: { type: 'segment', segment: 'billing_admins' },
} as const satisfies Record<string, z.input<typeof NotificationAudience>>;

/** Builds a valid service-announcement create payload. */
export function makeNotificationIntentCreateFixture(
  overrides: Partial<z.input<typeof NotificationIntentCreate>> = {},
): z.input<typeof NotificationIntentCreate> {
  return {
    senderType: 'staff',
    category: 'service_announcement',
    priority: 'normal',
    audience: notificationAudienceFixtures.user,
    channels: ['web', 'email'],
    subject: 'Scheduled maintenance tonight',
    body: {
      text: 'Docket will be briefly unavailable tonight.',
      html: '<p>Docket will be briefly unavailable tonight.</p>',
    },
    scheduledAt: '2026-07-07T05:00:00.000Z',
    replyPolicy: 'staff_inbox',
    idempotencyKey: 'maint-2026-07-06',
    ...overrides,
  };
}

/** Builds an invalid create payload with both required delivery content knobs empty. */
export function makeNotificationIntentCreateMissingContentFixture(): z.input<
  typeof NotificationIntentCreate
> {
  return makeNotificationIntentCreateFixture({
    senderType: 'system',
    category: 'security',
    priority: 'urgent',
    channels: [],
    subject: 'Security notice',
    body: {},
    replyPolicy: 'none',
  });
}

/** Builds a full notification intent representation. */
export function makeNotificationIntentOutFixture(
  overrides: Partial<z.input<typeof NotificationIntentOut>> = {},
): z.input<typeof NotificationIntentOut> {
  return {
    id: notificationFixtureIds.notificationId,
    senderType: 'staff',
    senderId: notificationFixtureIds.staffId,
    organizationId: null,
    category: 'service_announcement',
    priority: 'normal',
    audience: notificationAudienceFixtures.allUsers,
    channels: ['web', 'email'],
    subject: 'Scheduled maintenance tonight',
    body: { text: 'Maintenance tonight.' },
    replyPolicy: 'staff_inbox',
    status: 'scheduled',
    scheduledAt: '2026-07-07T05:00:00.000Z',
    createdAt: '2026-07-06T19:00:00.000Z',
    createdBy: notificationFixtureIds.staffId,
    ...overrides,
  };
}

/** Builds a recipient snapshot representation. */
export function makeNotificationRecipientOutFixture(
  overrides: Partial<z.input<typeof NotificationRecipientOut>> = {},
): z.input<typeof NotificationRecipientOut> {
  return {
    id: notificationFixtureIds.recipientId,
    notificationId: notificationFixtureIds.notificationId,
    userId: notificationFixtureIds.userId,
    organizationId: null,
    reason: 'segment_match',
    suppressions: [{ reason: 'quiet_hours', channel: 'email', detail: 'Held until 08:00' }],
    createdAt: '2026-07-06T19:00:00.000Z',
    ...overrides,
  };
}

/** Builds a per-channel delivery representation. */
export function makeNotificationDeliveryOutFixture(
  overrides: Partial<z.input<typeof NotificationDeliveryOut>> = {},
): z.input<typeof NotificationDeliveryOut> {
  return {
    id: notificationFixtureIds.recipientId,
    notificationId: notificationFixtureIds.notificationId,
    recipientId: notificationFixtureIds.recipientId,
    channel: 'email',
    destination: {
      type: 'email',
      valueMasked: 'a***@example.com',
      contactPointId: notificationFixtureIds.contactPointId,
    },
    status: 'sent',
    providerMessageId: 'provider_1',
    errorCode: null,
    errorMessage: null,
    sentAt: '2026-07-06T19:00:01.000Z',
    deliveredAt: null,
    readAt: null,
    actedAt: null,
    ...overrides,
  };
}

/** Builds a normalized inbound provider event representation. */
export function makeNotificationInboundEventOutFixture(
  overrides: Partial<z.input<typeof NotificationInboundEventOut>> = {},
): z.input<typeof NotificationInboundEventOut> {
  return {
    id: notificationFixtureIds.recipientId,
    notificationId: notificationFixtureIds.notificationId,
    deliveryId: notificationFixtureIds.recipientId,
    channel: 'email',
    kind: 'delivered',
    from: null,
    payload: { provider: 'mailpit' },
    receivedAt: '2026-07-06T19:00:02.000Z',
    ...overrides,
  };
}

/** Builds a user preference patch payload. */
export function makeNotificationPreferencePatchFixture(
  overrides: Partial<z.input<typeof NotificationPreferencePatch>> = {},
): z.input<typeof NotificationPreferencePatch> {
  return {
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
      [notificationFixtureIds.organizationId]: {
        workflow: { web: true, email: true, sms: false, push: true },
      },
    },
    ...overrides,
  };
}

/** Builds a full user preference representation. */
export function makeNotificationPreferenceOutFixture(
  overrides: Partial<z.input<typeof NotificationPreferenceOut>> = {},
): z.input<typeof NotificationPreferenceOut> {
  return {
    userId: notificationFixtureIds.userId,
    timezone: 'America/Los_Angeles',
    quietHours: makeNotificationPreferencePatchFixture().quietHours ?? null,
    categories: {
      security: { web: true, email: true, sms: true, push: true, locked: true },
    },
    organizations: {},
    updatedAt: '2026-07-06T19:00:00.000Z',
    ...overrides,
  };
}

/** Builds a create-contact-point payload. */
export function makeContactPointCreateFixture(
  overrides: Partial<z.input<typeof ContactPointCreate>> = {},
): z.input<typeof ContactPointCreate> {
  return {
    type: 'phone',
    value: '+17025550123',
    ...overrides,
  };
}

/** Builds a user contact point representation. */
export function makeContactPointOutFixture(
  overrides: Partial<z.input<typeof ContactPointOut>> = {},
): z.input<typeof ContactPointOut> {
  return {
    id: notificationFixtureIds.contactPointId,
    userId: notificationFixtureIds.userId,
    type: 'email',
    valueMasked: 'a***@example.com',
    status: 'active',
    primary: true,
    verifiedAt: '2026-07-06T19:00:00.000Z',
    disabledAt: null,
    createdAt: '2026-07-06T19:00:00.000Z',
    ...overrides,
  };
}
