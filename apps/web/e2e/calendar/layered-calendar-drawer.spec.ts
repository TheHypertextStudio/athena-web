/** Drawer-focused layered-calendar relationships, writeback, and conflict recovery coverage. */
import { signUpAndOnboard } from '../helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  todayAt,
} from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { scheduleItem } from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';

test.describe('layered calendar drawer', () => {
  test('one calendar item can create a task and link an existing task', async ({ page }) => {
    await signUpAndOnboard(page, 'LinkTasks');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'My calendar' });
    const item = makeCalendarItem({
      id: CALENDAR_IDS.taskLinkItem,
      layerId: layer.id,
      title: 'Quarterly planning',
    });
    const state = calendarRouteState({ layers: [layer], items: [item] });
    await installCalendarRoutes(page, state);

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    const body = scheduleItem(page, item.id).body;
    await expect(body).toBeVisible();
    await body.click();
    const drawer = page.getByRole('dialog');

    await drawer.getByLabel('New task relationship').selectOption('prep');
    await drawer.getByRole('button', { name: 'New' }).click();
    const composer = page.getByRole('dialog', { name: 'New task' });
    await composer.getByLabel('Task title').fill('Prep the deck');
    await composer.getByRole('button', { name: 'Create task' }).click();
    await expect(composer).toBeHidden();
    await expect.poll(() => state.taskLinkPosts.at(-1)?.input.role).toBe('prep');
    await expect(page).toHaveURL(/\/calendar$/);

    // The global modal dismisses the underlying modal drawer but honors the launcher's `stay`
    // policy. Reopen the same item to prove the awaited link invalidation reached its owner.
    await body.click();
    const refreshedDrawer = page.getByRole('dialog');
    await expect(refreshedDrawer.getByText('Prep the deck')).toBeVisible();

    await refreshedDrawer.getByRole('button', { name: 'Link' }).click();
    await refreshedDrawer.getByLabel('Task ID').fill(CALENDAR_IDS.existingTask);
    await refreshedDrawer.getByRole('button', { name: 'Link task' }).click();
    await expect(refreshedDrawer.getByText('Existing task')).toBeVisible();
    await expect(refreshedDrawer.getByText('Prep the deck')).toBeVisible();
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
    // Editing a text field autosaves on blur (no Save button), scoped to just that field.
    await drawer.getByLabel('Title').blur();

    await expect.poll(() => state.itemPatches.length).toBe(1);
    expect(state.itemPatches[0]).toEqual({
      itemId: item.id,
      patch: { title: 'Design review (revised)' },
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
    await expect(drawer.getByText(/^Read-only/)).toBeVisible();
    await expect(drawer.getByLabel('Title')).toBeDisabled();
  });
});
