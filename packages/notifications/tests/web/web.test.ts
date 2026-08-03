import { describe, expect, it } from 'vitest';

import {
  notificationDeliveryHintsFromBody,
  notificationWebTypeForCategory,
  renderNotificationWebProjection,
} from '../../src';

describe('notification web projection helpers', () => {
  it('renders a service announcement into an inbox-safe projection', () => {
    expect(
      renderNotificationWebProjection({
        category: 'service_announcement',
        subject: 'Scheduled maintenance',
        body: { text: 'Maintenance tonight.' },
        url: '/status',
      }),
    ).toEqual({
      type: 'service_announcement',
      body: {
        title: 'Scheduled maintenance',
        summary: 'Maintenance tonight.',
        url: '/status',
        category: 'service_announcement',
      },
    });
  });

  it('omits summary and url when the body has no text or url', () => {
    expect(
      renderNotificationWebProjection({
        category: 'billing',
        subject: 'Invoice ready',
        body: {},
      }),
    ).toEqual({
      type: 'status_change',
      body: { title: 'Invoice ready', category: 'billing' },
    });
  });
});

describe('notificationWebTypeForCategory', () => {
  it('maps service_announcement to itself', () => {
    expect(notificationWebTypeForCategory('service_announcement')).toBe('service_announcement');
  });

  it('maps workflow to automation', () => {
    expect(notificationWebTypeForCategory('workflow')).toBe('automation');
  });

  it('falls back to status_change for every other category', () => {
    for (const category of ['security', 'account', 'digest', 'billing', 'marketing'] as const) {
      expect(notificationWebTypeForCategory(category)).toBe('status_change');
    }
  });
});

describe('notificationDeliveryHintsFromBody', () => {
  it('parses a valid array of delivery hints', () => {
    const hints = notificationDeliveryHintsFromBody({
      deliveryChannels: [{ channel: 'email', status: 'sent', valueMasked: 'a***@example.com' }],
    });
    expect(hints).toEqual([{ channel: 'email', status: 'sent', valueMasked: 'a***@example.com' }]);
  });

  it('returns an empty array when the field is absent', () => {
    expect(notificationDeliveryHintsFromBody({})).toEqual([]);
  });

  it('returns an empty array when the field does not parse as delivery hints', () => {
    expect(notificationDeliveryHintsFromBody({ deliveryChannels: 'not-an-array' })).toEqual([]);
    expect(
      notificationDeliveryHintsFromBody({ deliveryChannels: [{ channel: 'unknown' }] }),
    ).toEqual([]);
  });
});
