/**
 * Browser contract for the shell's content column and its supplemental rail.
 *
 * The rail is a sibling of the content column. It must reserve the same tab-bar block when open
 * documents make that bar visible, or its panel and activity controls start 40px above the page
 * surface. This measures the rendered rectangles rather than reading Tailwind classes, because
 * the failure is visible geometry.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

const DESKTOP_VIEWPORTS = [1024, 1280, 1440, 1920, 2560, 3840] as const;

interface ShellRects {
  readonly main: { readonly top: number; readonly bottom: number; readonly width: number };
  readonly aside: { readonly top: number; readonly bottom: number };
  readonly activity: { readonly top: number; readonly bottom: number };
}

/** Read the visible desktop shell rectangles from the running product. */
async function shellRects(page: Page): Promise<ShellRects> {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main');
    const aside = document.querySelector<HTMLElement>('#shell-aside');
    const activity = document.querySelector<HTMLElement>('nav[aria-label="Panels"]');
    if (!main || !aside || !activity) throw new Error('The desktop shell rail must be present');
    const mainRect = main.getBoundingClientRect();
    const asideRect = aside.getBoundingClientRect();
    const activityRect = activity.getBoundingClientRect();
    return {
      main: { top: mainRect.top, bottom: mainRect.bottom, width: mainRect.width },
      aside: { top: asideRect.top, bottom: asideRect.bottom },
      activity: { top: activityRect.top, bottom: activityRect.bottom },
    };
  });
}

/** The docked rail and content surface must have identical vertical bounds. */
function expectRailAligned(rects: ShellRects, label: string): void {
  expect(Math.abs(rects.main.top - rects.aside.top), `${label}: panel top`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(rects.main.bottom - rects.aside.bottom),
    `${label}: panel bottom`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(rects.main.top - rects.activity.top),
    `${label}: activity top`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(rects.main.bottom - rects.activity.bottom),
    `${label}: activity bottom`,
  ).toBeLessThanOrEqual(1);
}

test('keeps desktop utility panels aligned with main, with and without document tabs', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { orgId } = await signUpAndOnboard(page, 'ShellRailAlignment');
  const teams = await apiJson<{ items: readonly { id: string }[] }>(
    page,
    `/v1/orgs/${orgId}/teams`,
  );
  const teamId = teams.items[0]?.id;
  expect(teamId, 'onboarding should create a personal team').toBeTruthy();
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Check docked shell rail alignment', teamId },
  });

  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Open documents' })).toHaveCount(0);

  for (const width of [1024, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    expectRailAligned(await shellRects(page), `${String(width)}px with no tabs`);
  }

  await page.goto(orgHref(orgId, `tasks/${task.id}`), { waitUntil: 'domcontentloaded' });
  const tablist = page.getByRole('tablist', { name: 'Open documents' });
  await expect(tablist).toBeVisible();
  const tabHeight = await tablist.evaluate(
    (element) => element.parentElement?.getBoundingClientRect().height,
  );
  expect(
    tabHeight,
    'the visible tab row must retain the shared 40px block size',
  ).toBeGreaterThanOrEqual(39);
  expect(
    tabHeight,
    'the visible tab row must retain the shared 40px block size',
  ).toBeLessThanOrEqual(41);

  let previousMainWidth = 0;
  for (const width of DESKTOP_VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    const rects = await shellRects(page);
    expectRailAligned(rects, `${String(width)}px with tabs`);
    expect(
      rects.main.width,
      `${String(width)}px retains the 416px main floor`,
    ).toBeGreaterThanOrEqual(416);
    expect(
      rects.main.width / width,
      `${String(width)}px retains the 40% main share floor`,
    ).toBeGreaterThanOrEqual(0.4);
    expect(
      rects.main.width,
      `${String(width)}px does not narrow main while the viewport widens`,
    ).toBeGreaterThanOrEqual(previousMainWidth);
    previousMainWidth = rects.main.width;
  }

  if (process.env['E2E_EVIDENCE'] === '1') {
    await page.screenshot({ path: testInfo.outputPath('shell-rail-aligned-3840px.png') });
  }
});
