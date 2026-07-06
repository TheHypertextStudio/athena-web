import { describe, expect, it } from 'vitest';

import { renderNotificationWebProjection } from '../src';

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
});
