import { describe, expect, it } from 'vitest';

import {
  ContactPointCreate,
  ContactPointOut,
  NotificationAudienceEstimateOut,
  NotificationAudience,
  NotificationDeliveryOut,
  NotificationInboundEventOut,
  NotificationIntentCreate,
  NotificationIntentOut,
  NotificationPreferencePatch,
  NotificationPreferenceOut,
  NotificationPreviewOut,
  NotificationRecipientOut,
} from '../src';
import {
  makeContactPointCreateFixture,
  makeContactPointOutFixture,
  makeNotificationDeliveryOutFixture,
  makeNotificationInboundEventOutFixture,
  makeNotificationIntentCreateFixture,
  makeNotificationIntentCreateMissingContentFixture,
  makeNotificationIntentOutFixture,
  makeNotificationPreferenceOutFixture,
  makeNotificationPreferencePatchFixture,
  makeNotificationRecipientOutFixture,
  notificationAudienceFixtures,
} from '../src/testing';

describe('notification service DTOs', () => {
  it('parses a service-announcement create request with web + email channels', () => {
    const parsed = NotificationIntentCreate.parse(makeNotificationIntentCreateFixture());

    expect(parsed.channels).toEqual(['web', 'email']);
    expect(parsed.audience).toEqual(notificationAudienceFixtures.user);
  });

  it('rejects an intent with no requested channels or message body', () => {
    const result = NotificationIntentCreate.safeParse(
      makeNotificationIntentCreateMissingContentFixture(),
    );

    expect(result.success).toBe(false);
  });

  it('parses every supported audience shape', () => {
    for (const audience of Object.values(notificationAudienceFixtures)) {
      expect(NotificationAudience.parse(audience)).toEqual(audience);
    }
  });

  it('parses intent, recipient, delivery, and inbound-event outputs', () => {
    const intent = NotificationIntentOut.parse(makeNotificationIntentOutFixture());
    expect(intent.status).toBe('scheduled');

    const recipient = NotificationRecipientOut.parse(makeNotificationRecipientOutFixture());
    expect(recipient.suppressions[0]?.reason).toBe('quiet_hours');

    const delivery = NotificationDeliveryOut.parse(makeNotificationDeliveryOutFixture());
    expect(delivery.destination.type).toBe('email');

    const inbound = NotificationInboundEventOut.parse({
      ...makeNotificationInboundEventOutFixture(),
      deliveryId: delivery.id,
    });
    expect(inbound.kind).toBe('delivered');
  });

  it('parses preference and contact-point DTOs', () => {
    const patch = NotificationPreferencePatch.parse(makeNotificationPreferencePatchFixture());
    expect(patch.quietHours?.start).toBe('18:00');

    const preference = NotificationPreferenceOut.parse(
      makeNotificationPreferenceOutFixture({ quietHours: patch.quietHours }),
    );
    expect(preference.categories['security']?.locked).toBe(true);

    expect(ContactPointCreate.parse(makeContactPointCreateFixture())).toEqual({
      type: 'phone',
      value: '+17025550123',
    });

    const contactPoint = ContactPointOut.parse(makeContactPointOutFixture());
    expect(contactPoint.primary).toBe(true);
  });

  it('parses staff estimate and preview DTOs', () => {
    const estimate = NotificationAudienceEstimateOut.parse({
      recipientCount: 1,
      channelCounts: {
        web: { send: 1, delay: 0, suppress: 0 },
        email: { send: 0, delay: 0, suppress: 1 },
        sms: { send: 0, delay: 0, suppress: 0 },
        push: { send: 0, delay: 0, suppress: 0 },
      },
      suppressions: [{ channel: 'email', reason: 'no_verified_contact_point', count: 1 }],
      approvalRequired: false,
      approvalReasons: [],
    });
    expect(estimate.suppressions[0]?.reason).toBe('no_verified_contact_point');

    const preview = NotificationPreviewOut.parse({
      subject: 'Scheduled maintenance',
      replyPolicy: 'staff_inbox',
      web: { title: 'Scheduled maintenance', body: 'Maintenance tonight.' },
      email: {
        subject: 'Scheduled maintenance',
        text: 'Maintenance tonight.',
        html: '<p>Maintenance tonight.</p>',
      },
      sms: { text: 'Docket: Scheduled maintenance. Maintenance tonight.' },
      push: { title: 'Scheduled maintenance', body: 'Maintenance tonight.' },
    });
    expect(preview.sms?.text).toContain('Docket');
  });
});
