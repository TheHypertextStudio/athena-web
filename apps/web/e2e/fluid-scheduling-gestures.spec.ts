/** Pointer editing, collision layout, permissions, and resilient-error browser contracts. */
import { CalendarItemId } from '@docket/types';
import type { OrgCreateResult, ScheduleComparisonOut } from '@docket/types';
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from './helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  shiftDate,
  utcAt,
} from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import {
  attachCalendarScreenshot,
  dragScheduleItemToLane,
  dragScheduleResizeGrip,
  scheduleItem,
  scheduleViewport,
  waitForSheetCompositorStability,
} from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';
import { apiJson } from './helpers/net';

const ANCHOR_DATE = '2026-07-13';
const NEXT_DATE = shiftDate(ANCHOR_DATE, 1);
const MOVABLE_ITEM_ID = CalendarItemId.parse('F3NV2AHRZ6ENW3BJS08FPX4CKT');
const COLLISION_IDS = [
  CalendarItemId.parse('F4NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('F5NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('F6NV2AHRZ6ENW3BJS08FPX4CKT'),
] as const;

/** Prove every critical drawer control remains inside a horizontally contained workspace. */
async function expectDrawerContentContained(page: Page, drawer: Locator): Promise<void> {
  await waitForSheetCompositorStability(page, drawer);
  const workspace = drawer.locator(':scope > div').first();
  await expect(workspace).toBeVisible();
  await expect
    .poll(() => workspace.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);

  const drawerBox = await drawer.boundingBox();
  if (!drawerBox) throw new Error('Calendar item drawer has no browser geometry.');
  const [drawerStackingOrder, highestStickyStackingOrder] = await Promise.all([
    drawer.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
    page
      .locator('main#main-content .sticky')
      .evaluateAll((elements) =>
        Math.max(
          ...elements.map((element) => Number.parseInt(getComputedStyle(element).zIndex, 10) || 0),
        ),
      ),
  ]);
  expect(drawerStackingOrder).toBeGreaterThan(highestStickyStackingOrder);
  expect(
    await drawer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === element || (hit !== null && element.contains(hit));
    }),
  ).toBe(true);
  for (const control of [
    drawer.getByRole('button', { name: 'Close calendar item' }),
    drawer.getByLabel('Starts'),
    drawer.getByLabel('Ends'),
    drawer.getByRole('button', { name: 'New', exact: true }),
    drawer.getByRole('button', { name: 'Link', exact: true }),
  ]) {
    await expect(control).toBeVisible();
    const controlBox = await control.boundingBox();
    if (!controlBox) throw new Error('Calendar drawer control has no browser geometry.');
    expect(controlBox.x).toBeGreaterThanOrEqual(drawerBox.x);
    expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);
    expect(
      await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === element || (hit !== null && element.contains(hit));
      }),
    ).toBe(true);
  }
}

test.use({ timezoneId: 'UTC', video: 'on' });

test.describe('fluid scheduling interaction contract', () => {
  test('moves across dates, resizes both edges, and gives three overlaps separate columns', async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
    await signUpAndOnboard(page, 'FluidGestures');
    const layer = makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' });
    const movable = makeCalendarItem({
      id: MOVABLE_ITEM_ID,
      layerId: layer.id,
      title: 'Move and resize me',
      startsAt: utcAt(ANCHOR_DATE, 9),
      endsAt: utcAt(ANCHOR_DATE, 10),
    });
    const collisions = [
      makeCalendarItem({
        id: COLLISION_IDS[0],
        layerId: layer.id,
        title: 'Overlap one',
        startsAt: utcAt(ANCHOR_DATE, 12),
        endsAt: utcAt(ANCHOR_DATE, 14),
      }),
      makeCalendarItem({
        id: COLLISION_IDS[1],
        layerId: layer.id,
        title: 'Overlap two',
        startsAt: utcAt(ANCHOR_DATE, 12, 15),
        endsAt: utcAt(ANCHOR_DATE, 13, 30),
      }),
      makeCalendarItem({
        id: COLLISION_IDS[2],
        layerId: layer.id,
        title: 'Overlap three',
        startsAt: utcAt(ANCHOR_DATE, 12, 30),
        endsAt: utcAt(ANCHOR_DATE, 13, 15),
      }),
    ];
    const state = calendarRouteState({
      layers: [layer],
      items: [movable, ...collisions],
      preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    for (const [column, itemId] of COLLISION_IDS.entries()) {
      const { card } = scheduleItem(page, itemId);
      await expect(card).toHaveAttribute('data-layout-column', String(column));
      await expect(card).toHaveAttribute('data-layout-column-count', '3');
    }
    const collisionBoxes = await Promise.all(
      COLLISION_IDS.map(async (itemId) => scheduleItem(page, itemId).card.boundingBox()),
    );
    expect(collisionBoxes.every(Boolean)).toBe(true);
    const [first, second, third] = collisionBoxes;
    if (!first || !second || !third) throw new Error('Collision cards have no browser geometry.');
    expect(second.x - (first.x + first.width)).toBeCloseTo(4, 0);
    expect(third.x - (second.x + second.width)).toBeCloseTo(4, 0);

    await dragScheduleItemToLane(page, movable.id, NEXT_DATE);
    await expect.poll(() => state.itemPatches.length).toBe(1);
    expect(state.itemPatches[0]).toEqual({
      itemId: movable.id,
      patch: {
        startsAt: `${NEXT_DATE}T09:00:00Z`,
        endsAt: `${NEXT_DATE}T10:00:00Z`,
      },
    });

    await dragScheduleResizeGrip(page, movable.id, 'start', 36);
    await expect.poll(() => state.itemPatches.length).toBe(2);
    expect(state.itemPatches[1]).toEqual({
      itemId: movable.id,
      patch: {
        startsAt: `${NEXT_DATE}T09:30:00Z`,
        endsAt: `${NEXT_DATE}T10:00:00Z`,
      },
    });

    await dragScheduleResizeGrip(page, movable.id, 'end', 36);
    await expect.poll(() => state.itemPatches.length).toBe(3);
    expect(state.itemPatches[2]).toEqual({
      itemId: movable.id,
      patch: {
        startsAt: `${NEXT_DATE}T09:30:00Z`,
        endsAt: `${NEXT_DATE}T10:30:00Z`,
      },
    });
    await expect(scheduleItem(page, movable.id).body).toContainText('Move and resize me');
    expect(state.itemPatches).toHaveLength(3);
    await attachCalendarScreenshot(page, testInfo, 'fluid-collisions-move-and-resize');
  });

  test('provider read-only items remain openable but expose no direct edit targets', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
    await signUpAndOnboard(page, 'FluidReadOnly');
    const layer = makeCalendarLayer({
      id: CALENDAR_IDS.googleReadOnlyLayer,
      connectionId: CALENDAR_IDS.googleConnection,
      provider: 'google',
      sourceKind: 'provider_calendar',
      title: 'Provider calendar',
      editableCore: false,
    });
    const item = makeCalendarItem({
      id: CALENDAR_IDS.readOnlyEvent,
      layerId: layer.id,
      connectionId: CALENDAR_IDS.googleConnection,
      kind: 'provider_event',
      provider: 'google',
      title: 'Provider read-only review',
      startsAt: utcAt(ANCHOR_DATE, 9),
      endsAt: utcAt(ANCHOR_DATE, 10),
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
    });
    const state = calendarRouteState({
      layers: [layer],
      items: [item],
      preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72 } },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    const { card, body } = scheduleItem(page, item.id);
    await expect(card.getByText('Read-only', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: `Move ${item.title}` })).toHaveCount(0);
    await expect(card.locator('[data-schedule-resize-target]')).toHaveCount(0);
    await body.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Read-only — no calendar write access granted')).toBeVisible();
    await expect(drawer.getByLabel('Title')).toBeDisabled();
    await expectDrawerContentContained(page, drawer);
    await attachCalendarScreenshot(page, testInfo, 'fluid-provider-read-only-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectDrawerContentContained(page, drawer);
    expect(state.itemPatches).toHaveLength(0);
    await attachCalendarScreenshot(page, testInfo, 'fluid-provider-read-only');
  });

  test('details-shared people cards open comparison-backed read-only details', async ({ page }) => {
    await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
    const { user } = await signUpAndOnboard(page, 'FluidSharedDetails');
    const workspace = await apiJson<OrgCreateResult>(page, '/v1/orgs', {
      method: 'POST',
      body: { name: 'Shared planning', isPersonal: false, vocabulary: 'startup' },
    });
    const comparison: ScheduleComparisonOut = {
      start: `${ANCHOR_DATE}T00:00:00.000Z`,
      end: `${NEXT_DATE}T00:00:00.000Z`,
      people: [
        {
          actorId: workspace.ownerActorId,
          displayName: user.name,
          avatar: null,
          timezone: 'America/Chicago',
          items: [
            {
              access: 'details',
              itemId: CALENDAR_IDS.readOnlyEvent,
              layerId: CALENDAR_IDS.googleReadOnlyLayer,
              kind: 'native_event',
              title: 'Shared roadmap review',
              startsAt: utcAt(ANCHOR_DATE, 15),
              endsAt: utcAt(ANCHOR_DATE, 16),
              allDayStartDate: null,
              allDayEndDate: null,
            },
          ],
        },
      ],
    };
    const state = calendarRouteState({
      layers: [makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' })],
      items: [],
      comparisonResponse: comparison,
      preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72 } },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'people' }).click();

    await scheduleItem(page, CALENDAR_IDS.readOnlyEvent).body.click();
    const dialog = page.getByRole('dialog', { name: 'Shared roadmap review' });
    await expect(dialog).toContainText('Read-only');
    await expect(dialog).toContainText(`Shared by ${user.name} with this workspace.`);
    await expect(dialog.locator('input, textarea, select')).toHaveCount(0);
    expect(state.ownedItemGets).toHaveLength(0);
    expect(state.itemPatches).toHaveLength(0);
  });

  test('hostile range failures show safe retry notices above intact, usable grids', async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
    await signUpAndOnboard(page, 'FluidSafeError');
    const state = calendarRouteState({
      layers: [makeCalendarLayer({ id: CALENDAR_IDS.nativeLayer, title: 'Docket' })],
      items: [],
      preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72 } },
      rangeFailure: {
        status: 500,
        body: {
          code: 'AGENT_CONFIGURATION_ERROR',
          title: 'Internal server error',
          detail: 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions',
        },
      },
      agendaFailure: {
        status: 500,
        body: 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions',
      },
    });
    await installCalendarRoutes(page, state);
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

    const schedule = scheduleViewport(page);
    await expect(schedule).toBeVisible();
    await expect(schedule).toHaveAttribute('data-lane-count', /[1-9][0-9]*/);
    await expect.poll(() => schedule.locator('[data-schedule-tick]').count()).toBeGreaterThan(0);
    const safeCopy = 'Calendar updates are temporarily unavailable. Showing what we have.';
    const calendarNotice = page
      .locator('main#main-content')
      .getByRole('status')
      .filter({ hasText: safeCopy });
    await expect(calendarNotice).toBeVisible();
    await expect(calendarNotice.getByText(safeCopy, { exact: true })).toBeVisible();
    await expect(calendarNotice.getByRole('button', { name: 'Retry' })).toBeEnabled();
    const [scheduleBox, noticeBox] = await Promise.all([
      schedule.boundingBox(),
      calendarNotice.boundingBox(),
    ]);
    if (!scheduleBox || !noticeBox) throw new Error('Degraded calendar notice has no geometry.');
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(scheduleBox.y);
    expect(noticeBox.x).toBeLessThan(scheduleBox.x + scheduleBox.width);
    expect(noticeBox.x + noticeBox.width).toBeGreaterThan(scheduleBox.x);
    await expect
      .poll(() =>
        schedule.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          );
          return hit !== null && element.contains(hit);
        }),
      )
      .toBe(true);
    const agenda = page.getByRole('complementary', { name: 'Agenda' });
    await expect(agenda).toBeVisible();
    await expect(agenda.getByRole('region', { name: 'Schedule' })).toBeVisible();
    const agendaNotice = agenda.getByRole('status').filter({ hasText: safeCopy });
    await expect(agendaNotice).toBeVisible();
    await expect(agendaNotice.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect(page.locator('body')).not.toContainText('Internal server error');
    await expect(page.locator('body')).not.toContainText('AGENT_MAX_TURNS');
    await attachCalendarScreenshot(page, testInfo, 'fluid-safe-error-overlay');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(schedule).toHaveAttribute('data-visible-lane-count', '1');
    await expect(schedule).toHaveAttribute('data-lane-count', '3');
    await expect(calendarNotice).toBeVisible();
    await expect(calendarNotice.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect
      .poll(async () => {
        const [narrowScheduleBox, narrowNoticeBox] = await Promise.all([
          schedule.boundingBox(),
          calendarNotice.boundingBox(),
        ]);
        return Boolean(
          narrowScheduleBox &&
          narrowNoticeBox &&
          narrowNoticeBox.y + narrowNoticeBox.height <= narrowScheduleBox.y &&
          narrowNoticeBox.x < narrowScheduleBox.x + narrowScheduleBox.width &&
          narrowNoticeBox.x + narrowNoticeBox.width > narrowScheduleBox.x,
        );
      })
      .toBe(true);
    await attachCalendarScreenshot(page, testInfo, 'fluid-safe-error-narrow');

    const rangeRequestCountBeforeRetry = state.rangeRequests.length;
    state.rangeFailure = undefined;
    await calendarNotice.getByRole('button', { name: 'Retry' }).click();
    await expect
      .poll(() => state.rangeRequests.length)
      .toBeGreaterThan(rangeRequestCountBeforeRetry);
    await expect(calendarNotice).toHaveCount(0);
    await expect(schedule).toBeVisible();
    await expect.poll(() => schedule.locator('[data-schedule-tick]').count()).toBeGreaterThan(0);

    await expect(page.locator('body')).not.toContainText('Internal server error');
    await expect(page.locator('body')).not.toContainText('AGENT_MAX_TURNS');
  });
});
