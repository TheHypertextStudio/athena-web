/** Drawer-focused layered-calendar relationships, writeback, and conflict recovery coverage. */
import { signUpAndOnboard } from './helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  todayAt,
} from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import { scheduleItem } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';

test.describe('layered calendar drawer', () => {
  test('one calendar item can create a task and link an existing task', async ({ page }) => {
    await signUpAndOnboard(page, 'LinkTasks');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'My calendar' });
    const item = makeCalendarItem({
      id: CALENDAR_IDS.taskLinkItem,
      layerId: layer.id,
      title: 'Quarterly planning',
    });
    await installCalendarRoutes(page, calendarRouteState({ layers: [layer], items: [item] }));

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    const body = scheduleItem(page, item.id).body;
    await expect(body).toBeVisible();
    await body.click();
    const drawer = page.getByRole('dialog');

    await drawer.getByRole('button', { name: 'New' }).click();
    await drawer.getByLabel('Title (optional)').fill('Prep the deck');
    await drawer.getByRole('button', { name: 'Create & link' }).click();
    await expect(drawer.getByText('Prep the deck')).toBeVisible();

    await drawer.getByRole('button', { name: 'Link' }).click();
    await drawer.getByLabel('Task ID').fill(CALENDAR_IDS.existingTask);
    await drawer.getByRole('button', { name: 'Link task' }).click();
    await expect(drawer.getByText('Existing task')).toBeVisible();
    await expect(drawer.getByText('Prep the deck')).toBeVisible();
  });

  test('editable provider event writes back and reflects a clean sync state', async ({ page }) => {
    await signUpAndOnboard(page, 'WriteBack');
    const layer = makeCalendarLayer({
      id: CALENDAR_IDS.googleWritableLayer,
      connectionId: CALENDAR_IDS.googleConnection,
      provider: 'google',
      sourceKind: 'provider_calendar',
      title: 'Ada',
      editableCore: true,
    });
    const item = makeCalendarItem({
      id: CALENDAR_IDS.writableEvent,
      layerId: layer.id,
      connectionId: CALENDAR_IDS.googleConnection,
      kind: 'provider_event',
      provider: 'google',
      title: 'Design review',
      syncState: 'clean',
    });
    const state = calendarRouteState({ layers: [layer], items: [item] });
    await installCalendarRoutes(page, state);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    const body = scheduleItem(page, item.id).body;
    await expect(body).toBeVisible();
    await body.click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Title').fill('Design review (revised)');
    await drawer.getByRole('button', { name: 'Save changes' }).click();

    await expect.poll(() => state.itemPatches.length).toBe(1);
    expect(state.itemPatches[0]).toEqual({
      itemId: item.id,
      patch: {
        title: 'Design review (revised)',
        description: '',
        location: '',
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      },
    });
    expect(state.items.find((candidate) => candidate.id === item.id)?.title).toBe(
      'Design review (revised)',
    );
    await expect(drawer.getByRole('heading', { name: 'Design review (revised)' })).toBeVisible();
    await expect(drawer.getByText('Synced')).toBeVisible();
  });

  test('conflict recovery remains available while permission-denied items explain read-only state', async ({
    page,
  }) => {
    await signUpAndOnboard(page, 'ConflictReadOnly');
    const layer = makeCalendarLayer({
      id: CALENDAR_IDS.googleWritableLayer,
      connectionId: CALENDAR_IDS.googleConnection,
      provider: 'google',
      sourceKind: 'provider_calendar',
      title: 'Ada',
      editableCore: true,
    });
    const conflict = makeCalendarItem({
      id: CALENDAR_IDS.conflictEvent,
      layerId: layer.id,
      connectionId: CALENDAR_IDS.googleConnection,
      kind: 'provider_event',
      provider: 'google',
      title: 'Budget sync',
      htmlLink: 'https://calendar.google.com/calendar/event?eid=budget-sync',
      syncState: 'conflict',
      hasConflict: true,
    });
    const readOnly = makeCalendarItem({
      id: CALENDAR_IDS.readOnlyEvent,
      layerId: layer.id,
      connectionId: CALENDAR_IDS.googleConnection,
      kind: 'provider_event',
      provider: 'google',
      title: 'All-hands',
      startsAt: todayAt(13),
      endsAt: todayAt(14),
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
    });
    await installCalendarRoutes(
      page,
      calendarRouteState({ layers: [layer], items: [conflict, readOnly] }),
    );

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await scheduleItem(page, conflict.id).body.click();
    const drawer = page.getByRole('dialog');
    const banner = drawer.getByRole('alert').filter({ hasText: 'Sync conflict' });
    await expect(banner.getByRole('link', { name: 'Open in provider' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Retry with local changes' })).toBeVisible();
    await page.keyboard.press('Escape');

    await scheduleItem(page, readOnly.id).body.click();
    await expect(drawer.getByText('Read-only — no calendar write access granted')).toBeVisible();
    await expect(drawer.getByLabel('Title')).toBeDisabled();
  });
});
