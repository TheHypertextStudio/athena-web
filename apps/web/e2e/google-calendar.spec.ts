/**
 * Google Calendar first-party integration e2e.
 *
 * Signs up a real throwaway user, opens the nested Calendar configuration surface, and exercises the
 * browser flow against deterministic Calendar API responses. Google OAuth itself is outside this
 * test's boundary; the mocked `/v1/me/calendar` + `/v1/agenda` responses stand in for linked Google
 * accounts/events while keeping the shell, routing, TanStack Query, and rendering real.
 */
import { signUpAndOnboard } from './helpers/app';
import { settingsHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';

const CONNECTION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CALENDAR_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const EVENT_ID = '01BX5ZZKBKACTAV9WEVGEMMVS0';

function calendarSettings(selected = true) {
  return {
    connections: [
      {
        id: CONNECTION_ID,
        provider: 'google',
        externalAccountId: 'google-sub-1',
        accountEmail: 'ada@example.com',
        accountName: 'Ada Lovelace',
        accountPictureUrl: null,
        status: 'connected',
        calendarsTotal: 2,
        calendarsEnabled: selected ? 1 : 0,
        lastSyncedAt: '2026-06-30T16:00:00.000Z',
        lastError: null,
        scopeState: {
          grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
          calendarRead: true,
          calendarWrite: false,
          capturedAt: '2026-06-30T15:00:00.000Z',
        },
        createdAt: '2026-06-30T15:00:00.000Z',
        updatedAt: '2026-06-30T16:00:00.000Z',
      },
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        connectionId: CONNECTION_ID,
        externalCalendarId: 'primary',
        title: 'Ada',
        description: null,
        timezone: 'America/Los_Angeles',
        color: '#16a34a',
        accessRole: 'owner',
        primary: true,
        selected,
        visibleByDefault: selected,
        lastSyncedAt: '2026-06-30T16:00:00.000Z',
        lastError: null,
        updatedAt: '2026-06-30T16:00:00.000Z',
      },
      {
        id: '01BX5ZZKBKACTAV9WEVGEMMVZZ',
        connectionId: CONNECTION_ID,
        externalCalendarId: 'team',
        title: 'Team',
        description: null,
        timezone: 'America/Los_Angeles',
        color: '#2563eb',
        accessRole: 'reader',
        primary: false,
        selected: false,
        visibleByDefault: false,
        lastSyncedAt: null,
        lastError: null,
        updatedAt: '2026-06-30T16:00:00.000Z',
      },
    ],
    layers: [
      {
        id: '01BX5ZZKBKACTAV9WEVGEMMVL1',
        connectionId: CONNECTION_ID,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'primary',
        title: 'Ada',
        description: null,
        timezone: 'America/Los_Angeles',
        color: '#16a34a',
        accessRole: 'owner',
        primary: true,
        selected,
        visibleByDefault: selected,
        editableCore: false,
        lastSyncedAt: '2026-06-30T16:00:00.000Z',
        lastError: null,
        watchExpiresAt: null,
        createdAt: '2026-06-30T15:00:00.000Z',
        updatedAt: '2026-06-30T16:00:00.000Z',
      },
    ],
  };
}

function agendaPayload(date: string) {
  return {
    date,
    entries: [
      {
        kind: 'google_calendar_event',
        event: {
          id: EVENT_ID,
          connectionId: CONNECTION_ID,
          calendarId: CALENDAR_ID,
          externalCalendarId: 'primary',
          externalEventId: 'event-1',
          status: 'confirmed',
          title: 'Design review',
          description: null,
          location: null,
          htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
          startsAt: `${date}T16:00:00.000Z`,
          endsAt: `${date}T17:00:00.000Z`,
          allDayStartDate: null,
          allDayEndDate: null,
          organizer: null,
          attendees: [],
          updatedExternalAt: null,
          createdAt: '2026-06-30T15:00:00.000Z',
          updatedAt: '2026-06-30T16:00:00.000Z',
        },
        connection: { id: CONNECTION_ID, accountEmail: 'ada@example.com', accountName: 'Ada' },
        calendar: {
          id: CALENDAR_ID,
          title: 'Ada',
          color: '#16a34a',
          timezone: 'America/Los_Angeles',
        },
      },
    ],
  };
}

test.describe('google calendar', () => {
  test('config is nested and feeds the agenda rail', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'Calendar');
    let selected = true;
    let patchSeen = false;
    let syncSeen = false;

    await page.route('**/v1/me/calendar', async (route) => {
      await route.fulfill({ json: calendarSettings(selected) });
    });
    await page.route('**/v1/me/calendar/sync', async (route) => {
      syncSeen = true;
      await route.fulfill({
        json: {
          connections: 1,
          calendars: 2,
          eventsCreated: 0,
          eventsUpdated: 1,
          eventsDeleted: 0,
          errors: [],
        },
      });
    });
    await page.route(`**/v1/me/calendar/calendars/${CALENDAR_ID}`, async (route) => {
      patchSeen = true;
      const body = route.request().postDataJSON() as { selected?: boolean };
      selected = Boolean(body.selected);
      await route.fulfill({ json: calendarSettings(selected) });
    });
    await page.route('**/v1/agenda?**', async (route) => {
      const requestedDate = new URL(route.request().url()).searchParams.get('date') ?? '2026-06-30';
      await route.fulfill({
        json: selected ? agendaPayload(requestedDate) : { date: requestedDate, entries: [] },
      });
    });

    await page.goto(settingsHref(orgId, 'connections'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /Google Calendar/ })).toBeVisible();
    await page.getByRole('link', { name: /Google Calendar/ }).click();

    await expect(page).toHaveURL(new RegExp(settingsHref(orgId, 'connections/google-calendar')));
    await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ada@example.com' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Ada/ })).toBeChecked();

    await page.getByRole('button', { name: 'Sync' }).click();
    await expect.poll(() => syncSeen).toBe(true);
    await expect(page.getByText('Updated 1 event.')).toBeVisible();

    await page.getByRole('checkbox', { name: /Ada/ }).click();
    await expect.poll(() => patchSeen).toBe(true);
    await expect(page.getByText('0 of 2 calendars visible')).toBeVisible();

    await page.getByRole('checkbox', { name: /Ada/ }).click();
    await expect(page.getByText('1 of 2 calendars visible')).toBeVisible();

    await page.goto('/today', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Design review')).toBeVisible();
  });
});
