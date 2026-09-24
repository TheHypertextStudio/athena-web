/** Browser proof that cross-day cards show clipped times while every segment opens one exact item. */
import { CalendarItemId } from '@docket/planning/ids';
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { makeCalendarItem, makeCalendarLayer } from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { scheduleLane } from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';

const OVERNIGHT_ID = CalendarItemId.parse('K0NV2AHRZ6ENW3BJS08FPX4CKT');
const THREE_DAY_ID = CalendarItemId.parse('M0NV2AHRZ6ENW3BJS08FPX4CKT');
const START_DATE = '2026-09-23';

test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 900 } });

/** One timed segment scoped to its actual date lane, since one item can have several cards. */
function segment(page: Page, date: string, itemId: string): Locator {
  return scheduleLane(page, date).locator(`[data-schedule-item-body="${itemId}"]`);
}

/** Reveal a clipped day segment when another concurrent item owns the readable card. */
async function revealSegment(
  page: Page,
  date: string,
  itemId: string,
  title: string,
): Promise<Locator> {
  const lane = scheduleLane(page, date);
  const card = segment(page, date, itemId);
  const disclosure = lane.getByRole('button', { name: /Show \d+ more events/ }).first();
  await expect
    .poll(async () => (await card.count()) + (await disclosure.count()))
    .toBeGreaterThan(0);
  if ((await card.count()) === 0) {
    await disclosure.click();
    await page.getByRole('button', { name: `Show ${title} on calendar` }).click();
  }
  await card.scrollIntoViewIfNeeded();
  return card;
}

test('shows each cross-day segment and saves one exact endpoint from the shared item form', async ({
  page,
}) => {
  await page.clock.setFixedTime('2026-09-24T12:00:00.000Z');
  await signUpAndOnboard(page, 'CrossDayTimes');

  const layer = makeCalendarLayer({
    id: 'BNNV2AHRZ6ENW3BJS08FPX4CKT',
    title: 'Docket',
  });
  const overnight = makeCalendarItem({
    id: OVERNIGHT_ID,
    layerId: layer.id,
    kind: 'native_event',
    title: 'Overnight handoff',
    startsAt: '2026-09-23T23:30:00Z',
    endsAt: '2026-09-24T01:15:00Z',
  });
  const threeDay = makeCalendarItem({
    id: THREE_DAY_ID,
    layerId: layer.id,
    kind: 'native_event',
    title: 'Three-day conference',
    startsAt: '2026-09-23T22:00:00Z',
    endsAt: '2026-09-25T02:00:00Z',
  });
  const state = calendarRouteState({
    layers: [layer],
    items: [overnight, threeDay],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);

  await page.goto(`/calendar?date=${START_DATE}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();

  const cases = [
    {
      item: overnight,
      dates: ['2026-09-23', '2026-09-24'],
      labels: ['11:30 PM – 12:00 AM', '12:00 AM – 1:15 AM'],
      wholeDates: 'Sep 23, 2026 – Sep 24, 2026',
      wholeTime: '11:30 PM – 1:15 AM',
    },
    {
      item: threeDay,
      dates: ['2026-09-23', '2026-09-24', '2026-09-25'],
      labels: ['10:00 PM – 12:00 AM', '12:00 AM – 12:00 AM next day', '12:00 AM – 2:00 AM'],
      wholeDates: 'Sep 23, 2026 – Sep 25, 2026',
      wholeTime: '10:00 PM – 2:00 AM',
    },
  ] as const;

  for (const { item, dates, labels, wholeDates, wholeTime } of cases) {
    if (!item.startsAt || !item.endsAt) throw new Error(`${item.title} needs exact timed bounds`);
    for (const [index, date] of dates.entries()) {
      const card = await revealSegment(page, date, item.id, item.title);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('title', `${item.title} · ${labels[index]}`);
      await card.click();

      const peek = page.locator(`[data-calendar-item-peek="${item.id}"]`);
      await expect(peek).toBeVisible();
      await expect(peek.getByText(wholeDates, { exact: true })).toBeVisible();
      await expect(peek.getByText(new RegExp(wholeTime))).toBeVisible();
      await peek.getByRole('button', { name: 'Open' }).click();

      const detail = page.getByRole('dialog', { name: item.title });
      await expect(detail).toBeVisible();
      await expect(detail.getByText(new RegExp(wholeDates))).toBeVisible();
      await expect(detail.getByText(new RegExp(wholeTime))).toBeVisible();
      await expect(detail.getByLabel('Starts')).toHaveValue(item.startsAt.slice(0, 16));
      await expect(detail.getByLabel('Ends')).toHaveValue(item.endsAt.slice(0, 16));
      await detail.getByRole('button', { name: 'Close calendar item' }).click();
      await expect(detail).toBeHidden();
    }
  }

  const lastSegment = await revealSegment(page, '2026-09-25', threeDay.id, threeDay.title);
  await lastSegment.click();
  const peek = page.locator(`[data-calendar-item-peek="${threeDay.id}"]`);
  await peek.getByRole('button', { name: 'Open' }).click();
  const detail = page.getByRole('dialog', { name: threeDay.title });
  await detail.getByLabel('Ends').fill('2026-09-25T03:15');

  await expect.poll(() => state.itemPatches.length).toBe(1);
  expect(state.itemPatches).toEqual([
    {
      itemId: threeDay.id,
      patch: {
        startsAt: '2026-09-23T22:00:00Z',
        endsAt: '2026-09-25T03:15:00Z',
      },
    },
  ]);
  await expect(detail.getByLabel('Ends')).toHaveValue('2026-09-25T03:15');
  expect(state.items.find((item) => item.id === threeDay.id)?.endsAt).toBe('2026-09-25T03:15:00Z');
  await detail.getByRole('button', { name: 'Close calendar item' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const persisted = segment(page, '2026-09-25', threeDay.id);
  await expect(persisted).toHaveAttribute('title', 'Three-day conference · 12:00 AM – 3:15 AM');
  expect(state.itemPatches).toHaveLength(1);
});
