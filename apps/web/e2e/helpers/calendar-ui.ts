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
  await body.scrollIntoViewIfNeeded();
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

/** Return the rendered text/background contrast ratio for one visible element. */
export async function renderedContrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Browser canvas context is unavailable for contrast sampling.');
    const sample = (value: string): readonly [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
      return [red, green, blue, alpha / 255];
    };
    const foreground = sample(getComputedStyle(element).color);
    let node: Element | null = element;
    let background: readonly [number, number, number, number] | null = null;
    while (node) {
      const candidate = sample(getComputedStyle(node).backgroundColor);
      if (candidate[3] >= 0.99) {
        background = candidate;
        break;
      }
      node = node.parentElement;
    }
    const resolvedBackground = background ?? ([255, 255, 255, 1] as const);
    const luminance = ([red, green, blue]: readonly number[]): number => {
      const linear = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(resolvedBackground);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  });
}

/** Focus a control through keyboard modality and report whether its focus treatment is visible. */
export async function hasVisibleKeyboardFocus(page: Page, locator: Locator): Promise<boolean> {
  await locator.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  return locator.evaluate((element) => {
    if (document.activeElement !== element) return false;
    const style = getComputedStyle(element);
    const visibleOutline =
      style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
    return visibleOutline || style.boxShadow !== 'none';
  });
}

/** Wait until an open sheet and the browser compositor have settled for geometry capture. */
export async function waitForSheetCompositorStability(page: Page, sheet: Locator): Promise<void> {
  await sheet.waitFor({ state: 'visible' });
  const handle = await sheet.elementHandle();
  if (!handle) throw new Error('Visible sheet has no element handle.');
  try {
    await page.waitForFunction(
      (element) =>
        getComputedStyle(element).transform === 'none' &&
        element
          .getAnimations()
          .every(
            (animation) =>
              !animation.pending &&
              (animation.playState === 'finished' || animation.playState === 'idle'),
          ),
      handle,
    );
  } finally {
    await handle.dispose();
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let remainingFrames = 4;
        const settle = (): void => {
          remainingFrames -= 1;
          if (remainingFrames === 0) resolve();
          else requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
      }),
  );
}

/** Persist and attach a full-page PNG alongside the describe-level Playwright video. */
export async function attachCalendarScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.waitForFunction(() => {
    const main = document.querySelector('main#main-content');
    return (
      main !== null &&
      !main.classList.contains('animate-org-rebind') &&
      getComputedStyle(main).opacity === '1'
    );
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
