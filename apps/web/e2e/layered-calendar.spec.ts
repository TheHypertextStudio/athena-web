/** Layered-calendar page coverage over browser-visible deterministic provider fixtures. */
import type { CalendarItemOut } from '@docket/types';

import { signUpAndOnboard } from './helpers/app';
import { CALENDAR_IDS, makeCalendarItem, makeCalendarLayer } from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import { scheduleItem } from './helpers/calendar-ui';
import { orgHref, settingsHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';

test.describe('layered calendar', () => {
  test('read-only provider items stay visible and openable without move or resize affordances', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'ReadOnly');
    const layer = makeCalendarLayer({
      id: CALENDAR_IDS.googleReadOnlyLayer,
      connectionId: CALENDAR_IDS.googleConnection,
      provider: 'google',
      sourceKind: 'provider_calendar',
      title: 'Ada',
      accessRole: 'owner',
      editableCore: false,
    });
    const item = makeCalendarItem({
      id: CALENDAR_IDS.readOnlyEvent,
      layerId: layer.id,
      connectionId: CALENDAR_IDS.googleConnection,
      kind: 'provider_event',
      provider: 'google',
      title: 'Design review',
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
    });
    await installCalendarRoutes(page, calendarRouteState({ layers: [layer], items: [item] }));
    await page.route('**/v1/me/calendar', async (route) => {
      await route.fulfill({
        json: {
          connections: [
            {
              id: CALENDAR_IDS.googleConnection,
              provider: 'google',
              externalAccountId: 'google-sub-1',
              accountEmail: 'ada@example.com',
              accountName: 'Ada Lovelace',
              accountPictureUrl: null,
              status: 'connected',
              calendarsTotal: 1,
              calendarsEnabled: 1,
              lastSyncedAt: '2026-07-05T16:00:00.000Z',
              lastError: null,
              scopeState: {
                grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
                calendarRead: true,
                calendarWrite: false,
                capturedAt: '2026-07-05T15:00:00.000Z',
              },
              createdAt: '2026-07-05T15:00:00.000Z',
              updatedAt: '2026-07-05T16:00:00.000Z',
            },
          ],
          calendars: [],
          layers: [layer],
        },
      });
    });
    await page.route('**/v1/agenda?**', async (route) => {
      const requestedDate = new URL(route.request().url()).searchParams.get('date');
      if (!requestedDate) {
        await route.fulfill({ status: 400, json: { code: 'MISSING_DATE' } });
        return;
      }
      await route.fulfill({
        json: {
          date: requestedDate,
          entries: [
            {
              kind: 'google_calendar_event',
              event: {
                id: '01BX5ZZKBKACTAV9WEVGEMMVS0',
                connectionId: CALENDAR_IDS.googleConnection,
                calendarId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
                externalCalendarId: 'primary',
                externalEventId: 'event-1',
                status: 'confirmed',
                title: 'Design review',
                description: null,
                location: null,
                htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
                startsAt: `${requestedDate}T16:00:00.000Z`,
                endsAt: `${requestedDate}T17:00:00.000Z`,
                allDayStartDate: null,
                allDayEndDate: null,
                organizer: null,
                attendees: [],
                updatedExternalAt: null,
                createdAt: '2026-07-05T15:00:00.000Z',
                updatedAt: '2026-07-05T16:00:00.000Z',
              },
              connection: {
                id: CALENDAR_IDS.googleConnection,
                accountEmail: 'ada@example.com',
                accountName: 'Ada',
              },
              calendar: {
                id: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
                title: 'Ada',
                color: '#16a34a',
                timezone: null,
              },
            },
          ],
        },
      });
    });

    await page.goto(settingsHref(orgId, 'connections/google-calendar'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('Calendar read-only')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable calendar editing' })).toBeEnabled();

    await page.goto(orgHref(orgId, 'my-work'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Design review').first()).toBeVisible();

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    const card = scheduleItem(page, item.id).card;
    await expect(card.getByText('Read-only', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: `Move ${item.title}` })).toHaveCount(0);
    await expect(card.locator('[data-schedule-resize-target]')).toHaveCount(0);
    await scheduleItem(page, item.id).body.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Read-only — no calendar write access granted')).toBeVisible();
    await expect(drawer.getByLabel('Title')).toBeDisabled();
    await expect(drawer.getByLabel('Description')).toBeDisabled();
    await expect(drawer.getByLabel('Location')).toBeDisabled();
    await expect(drawer.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  });

  test('layer visibility reshapes the rolling canvas live without a document reload', async ({
    page,
  }) => {
    await signUpAndOnboard(page, 'LayerToggle');
    const layer = makeCalendarLayer({
      id: CALENDAR_IDS.nativeLayer,
      title: 'Focus blocks',
      selected: true,
    });
    const item = makeCalendarItem({
      id: CALENDAR_IDS.existingNativeItem,
      layerId: layer.id,
      title: 'Deep work',
    });
    const state = calendarRouteState({ layers: [layer], items: [item] });
    await installCalendarRoutes(page, state);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await expect(scheduleItem(page, item.id).body).toBeVisible();

    // Creating one fixture-backed event invalidates the server-hydrated layers key immediately;
    // this replaces the obsolete 31-second staleness wait and Week-mode query-key trick.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('Title').fill('Refresh layer controls');
    await page.getByRole('button', { name: 'Create event' }).click();
    const toggle = page.getByRole('checkbox', { name: 'Toggle Focus blocks visibility' });
    await expect(toggle).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __e2eNoReloadMarker?: boolean }).__e2eNoReloadMarker = true;
    });
    await toggle.click();
    await expect(scheduleItem(page, item.id).body).toHaveCount(0);
    await toggle.click();
    await expect(scheduleItem(page, item.id).body).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __e2eNoReloadMarker?: boolean }).__e2eNoReloadMarker,
      ),
    ).toBe(true);
  });

  test('Docket event create, edit, and delete needs no provider account', async ({ page }) => {
    await signUpAndOnboard(page, 'NativeEvent');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'My calendar' });
    const items: CalendarItemOut[] = [];
    const state = calendarRouteState({
      layers: [layer],
      items,
      nextCreatedItemId: CALENDAR_IDS.createdNativeItem,
    });
    await installCalendarRoutes(page, state);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('Title').fill('Focus block');
    await page.getByRole('button', { name: 'Create event' }).click();

    const body = scheduleItem(page, CALENDAR_IDS.createdNativeItem).body;
    await expect(body).toBeVisible();
    await body.click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Title').fill('Deep focus block');
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer.getByRole('heading', { name: 'Deep focus block' })).toBeVisible();

    await drawer.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(body).toHaveCount(0);
  });
});
