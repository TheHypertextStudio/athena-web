/** Geometry-aware browser input helpers for the fluid scheduling canvas. */
import type { Locator, Page, TestInfo } from '@playwright/test';

/** Locate the always-mounted bounded schedule viewport. */
export function scheduleViewport(page: Page): Locator {
  return page.locator('main#main-content').getByRole('region', { name: 'Schedule' });
}

/** Locate one arbitrary date lane by its stable scheduling id. */
export function scheduleLane(page: Page, date: string): Locator {
  return page.locator('main#main-content').locator(`[data-schedule-lane="date:${date}"]`);
}

/** Locate one timed card and its stable direct-manipulation body. */
export function scheduleItem(
  page: Page,
  itemId: string,
): {
  readonly card: Locator;
  readonly body: Locator;
} {
  const card = page.locator('main#main-content').locator(`[data-schedule-item="${itemId}"]`);
  return { card, body: card.locator(`[data-schedule-item-body="${itemId}"]`) };
}

/** Drag a blank wall-clock region with real browser mouse input. */
export async function dragScheduleRegion(
  page: Page,
  date: string,
  startMinutes: number,
  endMinutes: number,
  pixelsPerHour: number,
): Promise<void> {
  const lane = scheduleLane(page, date);
  const box = await lane.boundingBox();
  if (!box) throw new Error(`Schedule lane ${date} has no browser geometry.`);
  const x = box.x + box.width * 0.8;
  const y = (minutes: number): number => box.y + (minutes / 60) * pixelsPerHour;
  await page.mouse.move(x, y(startMinutes));
  await page.mouse.down();
  await page.mouse.move(x, y(endMinutes), { steps: 6 });
  await page.mouse.up();
}

/** Move a card body into another visible lane while preserving its vertical position. */
export async function dragScheduleItemToLane(
  page: Page,
  itemId: string,
  targetDate: string,
): Promise<void> {
  const { body } = scheduleItem(page, itemId);
  const [bodyBox, laneBox] = await Promise.all([
    body.boundingBox(),
    scheduleLane(page, targetDate).boundingBox(),
  ]);
  if (!bodyBox || !laneBox) throw new Error(`Schedule move for ${itemId} has no browser geometry.`);
  const from = { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + bodyBox.height / 2 };
  const to = { x: laneBox.x + laneBox.width / 2, y: from.y };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** Drag one visible start/end grip by an exact physical vertical delta. */
export async function dragScheduleResizeGrip(
  page: Page,
  itemId: string,
  edge: 'start' | 'end',
  deltaY: number,
): Promise<void> {
  const { card } = scheduleItem(page, itemId);
  await card.hover();
  const grip = card.locator(`[data-schedule-resize-target="${edge}"]`);
  const box = await grip.boundingBox();
  if (!box) throw new Error(`Schedule ${edge} grip for ${itemId} has no browser geometry.`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 6 });
  await page.mouse.up();
}

/** Perform a native HTML drag between two rendered controls using only browser mouse input. */
export async function dragLocatorToLocator(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const [sourceBox, targetBox] = await Promise.all([source.boundingBox(), target.boundingBox()]);
  if (!sourceBox || !targetBox) throw new Error('Relationship drag has no browser geometry.');
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Persist and attach a full-page PNG alongside the describe-level Playwright video. */
export async function attachCalendarScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.waitForFunction(() => {
    const main = document.querySelector('main#main-content');
    return main !== null && !main.classList.contains('animate-org-rebind');
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  const fileName = name.endsWith('.png') ? name : `${name}.png`;
  const path = testInfo.outputPath(fileName);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
