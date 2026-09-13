import { makeNotificationPreferenceOutFixture } from '@docket/notifications/testing';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/components/settings/settings-section-page', () => ({
  SettingsSectionPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../src/components/settings/contact-points-section', () => ({
  ContactPointsSection: () => null,
}));
// Preference controls have their own suite; this test drives the page's actual mutation/client.
vi.mock('../../../src/components/settings/notification-preferences-section', () => ({
  NotificationPreferencesSection: ({
    onPatch,
  }: {
    onPatch: (patch: { timezone: string }) => Promise<void>;
  }) => (
    <button onClick={() => void onPatch({ timezone: 'America/Los_Angeles' })}>Save timezone</button>
  ),
}));

import NotificationsSettingsPage from '../../../src/app/(app)/settings/notifications/page';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('notification settings HTTP ownership', () => {
  it('reads and updates preferences through the personal notification family', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(
          input instanceof Request ? input.url : input.toString(),
          'https://docket.example.test',
        ).pathname;
        requests.push(`${init?.method ?? 'GET'} ${path}`);
        if (path === '/v1/me/contact-points') return Response.json({ items: [] });
        if (path !== '/v1/me/notifications/preferences') return Response.json({}, { status: 404 });
        return Response.json(makeNotificationPreferenceOutFixture());
      }),
    );
    const { wrapper } = makeQueryWrapper();
    render(<NotificationsSettingsPage />, { wrapper });
    await waitFor(() => {
      expect(requests).toContain('GET /v1/me/notifications/preferences');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Save timezone' }));
    await waitFor(() => {
      expect(requests).toContain('PATCH /v1/me/notifications/preferences');
      expect(
        requests.filter((request) => request === 'GET /v1/me/notifications/preferences').length,
      ).toBeGreaterThan(1);
    });
    expect(requests.some((request) => request.includes('notification-preferences'))).toBe(false);
  });
});
