/** The date axis gives a phone one whole day and adds days only as its own canvas grows. */
import { signUpAndOnboard } from '../helpers/app';
import { CALENDAR_IDS, makeCalendarItem, makeCalendarLayer } from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { expect, test } from '../helpers/fixtures';

test.use({ timezoneId: 'UTC' });

test('shows the selected period in server HTML before hydration or item loading', async ({
  browser,
  page,
}, testInfo) => {
  await signUpAndOnboard(page, 'CalendarFirstPaint');
  const timezone = 'America/Los_Angeles';
  const preferencesResponse = await page.request.patch(
    new URL('/v1/hub/preferences', page.url()).toString(),
    { data: { timezone } },
  );
  expect(preferencesResponse.ok()).toBe(true);
  const initialContext = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
    timezoneId: 'UTC',
    viewport: { width: 390, height: 844 },
  });
  try {
    const initialPage = await initialContext.newPage();
    const response = await initialPage.goto(new URL('/calendar', page.url()).toString(), {
      waitUntil: 'domcontentloaded',
    });
    const schedule = initialPage.getByRole('region', { name: 'Schedule' });
    const expectedDate = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(response?.headers()['date'] ?? Date.now()));
    await expect(schedule).toHaveAttribute('data-schedule-measuring', '');
    await expect(initialPage.locator('[data-calendar-page] h1')).toHaveAttribute(
      'aria-label',
      expectedDate,
    );
    await expect(schedule.getByText('All day')).toBeVisible();
    await expect(schedule.locator('[data-schedule-hour]').first()).toHaveText(/AM|PM/);
    for (const width of [320, 390, 768]) {
      await initialPage.setViewportSize({ width, height: 844 });
      await initialPage.screenshot({
        path: testInfo.outputPath(`calendar-${String(width)}x844-first-paint.png`),
      });
    }
  } finally {
    await initialContext.close();
  }
});

test('keeps one date lane on phones and fills wider canvases progressively', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (error.message.includes('Hydration failed')) hydrationErrors.push(error.message);
  });
  await page.clock.setFixedTime('2026-09-23T17:00:00.000Z');
  await signUpAndOnboard(page, 'ResponsiveLanes');
  const layer = makeCalendarLayer({ id: 'Q0NV2AHRZ6ENW3BJS08FPX4CKT', title: 'Docket' });
  await installCalendarRoutes(page, calendarRouteState({ layers: [layer], items: [] }));
  await page.goto('/calendar?date=2026-09-23', { waitUntil: 'domcontentloaded' });

  const schedule = page.getByRole('region', { name: 'Schedule' });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(schedule).toHaveAttribute('data-visible-lane-count', '1');
    await expect(page.getByRole('heading', { name: 'September 23, 2026' })).toBeVisible();
  }

  await page.setViewportSize({ width: 768, height: 844 });
  await expect
    .poll(async () => Number(await schedule.getAttribute('data-visible-lane-count')))
    .toBeGreaterThan(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(schedule).toHaveAttribute('data-visible-lane-count', '7');
  expect(hydrationErrors).toEqual([]);
});

test('opens a phone event in a full-height workspace with readable schedule fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime('2026-09-23T17:00:00.000Z');
  await signUpAndOnboard(page, 'MobileEventWorkspace');
  const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
  const item = makeCalendarItem({
    id: CALENDAR_IDS.writableEvent,
    layerId: layer.id,
    title: 'Design review for the October launch and customer handoff',
    startsAt: '2026-09-23T16:00:00.000Z',
    endsAt: '2026-09-23T17:30:00.000Z',
  });
  await installCalendarRoutes(page, calendarRouteState({ layers: [layer], items: [item] }));
  await page.goto('/calendar', { waitUntil: 'networkidle' });

  await page
    .getByRole('button', { name: /^Design review for the October launch/ })
    .first()
    .click();
  await expect(page.locator('[data-calendar-item-peek]')).toHaveCount(0);
  const workspace = page.getByRole('dialog', { name: item.title });
  await expect(workspace).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue(item.title);
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.x ?? -1)).toBe(0);
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.y ?? -1)).toBe(0);
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.height ?? 0)).toBe(844);
  const start = await workspace.getByLabel('Starts').boundingBox();
  const end = await workspace.getByLabel('Ends').boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  expect(start?.width ?? 0).toBeGreaterThan(250);
  expect(end?.y ?? 0).toBeGreaterThan((start?.y ?? 0) + 32);
  await expect(workspace.getByRole('button', { name: 'Close calendar item' })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await expect(workspace).toBeVisible();
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.x ?? -1)).toBe(0);
  await expect.poll(async () => Math.round((await workspace.boundingBox())?.width ?? 0)).toBe(320);
  expect((await workspace.getByLabel('Starts').boundingBox())?.width ?? 0).toBeGreaterThan(250);
});
