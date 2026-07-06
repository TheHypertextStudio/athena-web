import { describe, expect, it } from 'vitest';

import {
  defaultNotificationChannelPreference,
  notificationPreferenceAllowsChannel,
  notificationQuietHoursActive,
} from '../src';

describe('notification preference helpers', () => {
  it('centralizes category/channel defaults', () => {
    expect(defaultNotificationChannelPreference('service_announcement')).toEqual({
      web: true,
      email: true,
      sms: false,
      push: false,
    });
    expect(defaultNotificationChannelPreference('workflow')).toEqual({
      web: true,
      email: false,
      sms: false,
      push: false,
    });
    expect(defaultNotificationChannelPreference('security')).toMatchObject({
      web: true,
      email: true,
      sms: true,
      locked: true,
    });
  });

  it('applies category and organization overrides while preserving locked categories', () => {
    expect(
      notificationPreferenceAllowsChannel({
        category: 'service_announcement',
        channel: 'email',
        preferences: {
          categories: { service_announcement: { email: false } },
          organizations: {},
        },
      }),
    ).toBe(false);

    expect(
      notificationPreferenceAllowsChannel({
        category: 'workflow',
        channel: 'email',
        organizationId: 'org_123',
        preferences: {
          categories: { workflow: { email: false } },
          organizations: { org_123: { workflow: { email: true } } },
        },
      }),
    ).toBe(true);

    expect(
      notificationPreferenceAllowsChannel({
        category: 'security',
        channel: 'email',
        preferences: {
          categories: { security: { email: false } },
          organizations: {},
        },
      }),
    ).toBe(true);
  });

  it('detects quiet hours in the user timezone, including overnight windows', () => {
    expect(
      notificationQuietHoursActive(
        {
          enabled: true,
          start: '18:00',
          end: '08:00',
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        },
        'America/Los_Angeles',
        new Date('2026-07-07T03:00:00.000Z'),
      ),
    ).toBe(true);

    expect(
      notificationQuietHoursActive(
        {
          enabled: true,
          start: '18:00',
          end: '08:00',
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        },
        'America/Los_Angeles',
        new Date('2026-07-07T17:00:00.000Z'),
      ),
    ).toBe(false);
  });
});
