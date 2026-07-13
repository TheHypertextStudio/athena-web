/** Browser proof that dense calendar clusters retain every direct-edit interaction. */
import { CalendarItemId } from '@docket/types';

import { signUpAndOnboard } from './helpers/app';
import { makeCalendarItem, makeCalendarLayer, utcAt } from './helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from './helpers/calendar-routes';
import { attachCalendarScreenshot, scheduleItem, scheduleViewport } from './helpers/calendar-ui';
import { expect, test } from './helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';
const DENSE_ITEM_IDS = [
  CalendarItemId.parse('H1NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H2NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H3NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H4NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H5NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H6NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H7NV2AHRZ6ENW3BJS08FPX4CKT'),
  CalendarItemId.parse('H8NV2AHRZ6ENW3BJS08FPX4CKT'),
] as const;

test.use({ timezoneId: 'UTC', video: 'on' });

test('promotes a hidden dense event into the real pointer-edit surface', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  await signUpAndOnboard(page, 'FluidDenseOverflow');
  const layer = makeCalendarLayer({ id: 'BNNV2AHRZ6ENW3BJS08FPX4CKT', title: 'Docket' });
  const items = DENSE_ITEM_IDS.map((id, index) =>
    makeCalendarItem({
      id,
      layerId: layer.id,
      title: `Dense event ${String(index + 1)}`,
      startsAt: utcAt(ANCHOR_DATE, 18),
      endsAt: utcAt(ANCHOR_DATE, 20),
    }),
  );
  const promotedItem = items.at(-1);
  if (!promotedItem) throw new Error('Dense scheduling fixture has no promotable item.');
  const state = calendarRouteState({
    layers: [layer],
    items,
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);
  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });

  await expect(scheduleItem(page, promotedItem.id).card).toHaveCount(0);
  const calendar = scheduleViewport(page).first();
  const overflowTrigger = calendar.getByRole('button', {
    name: /^Show \d+ more events in /,
  });
  await expect(overflowTrigger).toBeVisible();
  await overflowTrigger.click();
  const disclosure = page.getByRole('dialog', { name: /more events in / });
  await expect(disclosure).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Show ${promotedItem.title} on calendar` }),
  ).toBeVisible();
  await attachCalendarScreenshot(page, testInfo, 'fluid-dense-overflow-disclosure');

  await page.getByRole('button', { name: `Show ${promotedItem.title} on calendar` }).click();
  await expect(disclosure).toBeHidden();
  const promoted = scheduleItem(page, promotedItem.id);
  await expect(promoted.card).toBeVisible();
  await expect(promoted.body).toBeFocused();
  await expect(
    promoted.card.getByRole('button', { name: `Move ${promotedItem.title}` }),
  ).toHaveCount(1);
  await expect(promoted.card.locator('[data-schedule-resize-target="start"]')).toHaveCount(1);
  await expect(promoted.card.locator('[data-schedule-resize-target="end"]')).toHaveCount(1);

  await promoted.card.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  await expect
    .poll(async () => {
      const [calendarBox, promotedBox] = await Promise.all([
        calendar.boundingBox(),
        promoted.card.boundingBox(),
      ]);
      if (!calendarBox || !promotedBox) return false;
      return (
        promotedBox.y - calendarBox.y > 48 &&
        calendarBox.y + calendarBox.height - (promotedBox.y + promotedBox.height) > 48
      );
    })
    .toBe(true);
  await calendar.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let previousScrollTop = element.scrollTop;
        let stableFrames = 0;
        const observe = (): void => {
          if (element.scrollTop === previousScrollTop) stableFrames += 1;
          else stableFrames = 0;
          previousScrollTop = element.scrollTop;
          if (stableFrames >= 4) resolve();
          else requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      }),
  );
  const bodyBox = await promoted.body.boundingBox();
  if (!bodyBox) throw new Error('Promoted dense event body has no browser geometry.');
  const bodyX = bodyBox.x + bodyBox.width / 2;
  const bodyY = bodyBox.y + bodyBox.height / 2;
  expect(
    await page.evaluate(
      ({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit instanceof HTMLElement
          ? hit.closest<HTMLElement>('[data-schedule-item-body]')?.dataset['scheduleItemBody']
          : undefined;
      },
      { x: bodyX, y: bodyY },
    ),
  ).toBe(promotedItem.id);
  await page.mouse.move(bodyX, bodyY);
  await page.mouse.down();
  await page.mouse.move(bodyX, bodyY + 36, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => state.itemPatches.length).toBe(1);
  expect(state.itemPatches[0]).toEqual({
    itemId: promotedItem.id,
    patch: {
      startsAt: `${ANCHOR_DATE}T18:30:00Z`,
      endsAt: `${ANCHOR_DATE}T20:30:00Z`,
    },
  });
  await promoted.card.hover();
  await expect(promoted.card.locator('[data-schedule-resize-indicator="end"]')).toBeVisible();
  await attachCalendarScreenshot(page, testInfo, 'fluid-dense-overflow-promoted-edit');
});
