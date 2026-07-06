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
});
