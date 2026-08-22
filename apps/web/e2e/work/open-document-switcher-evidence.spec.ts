/** Authenticated visual and interaction coverage for the open-document switcher. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { OpenTab } from '@docket/ui/components';

import { signUpAndOnboard } from '../helpers/app';
import { ORIGIN, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch, apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-21-open-document-switcher',
);
const ACTIVE_TITLE = 'Open Switcher Active Task';
const LONG_BACKGROUND_TITLE =
  'Northern corridor transfer access analysis for every station, every bus connection, and every rider need';
const BACKGROUND_TITLES = Array.from({ length: 12 }, (_, index) =>
  index === 0 ? LONG_BACKGROUND_TITLE : `Background document ${String(index + 1).padStart(2, '0')}`,
);

test.use({ serviceWorkers: 'block' });

/** Return a configured background title without weakening indexed-access checks. */
function backgroundTitleAt(index: number): string {
  const title = BACKGROUND_TITLES[index];
  if (title === undefined) throw new Error(`No background title exists at index ${String(index)}.`);
  return title;
}

/** Create the one real task that the switcher marks as active. */
async function createTask(page: Page, orgId: string, teamId: string): Promise<string> {
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: ACTIVE_TITLE, teamId },
  });
  return task.id;
}

/** Build persisted entries for the active task and valid background documents. */
function persistedTabs(
  orgId: string,
  taskId: string,
  backgroundTaskIds: readonly string[],
): readonly OpenTab[] {
  const active: OpenTab = {
    key: `task:${orgId}:${taskId}`,
    type: 'task',
    orgId,
    id: taskId,
    title: ACTIVE_TITLE,
    href: orgHref(orgId, `tasks/${taskId}`),
  };
  const background = BACKGROUND_TITLES.map((title, index): OpenTab => {
    const id = backgroundTaskIds[index];
    if (!id) throw new Error(`The background task for ${title} was not created.`);
    return {
      key: `task:${orgId}:${id}`,
      type: 'task',
      orgId,
      id,
      title,
      href: orgHref(orgId, `tasks/${id}`),
    };
  });
  return [active, ...background];
}

/** Persist the test's exact tab model before the app shell hydrates it. */
async function seedTabs(page: Page, userId: string, tabs: readonly OpenTab[]): Promise<void> {
  await page.evaluate(
    ({ key, entries }) => {
      sessionStorage.setItem(key, JSON.stringify(entries));
    },
    { key: `docket:open-tabs:${userId}`, entries: tabs },
  );
}

/** Open the switcher and wait for the search field that receives initial focus. */
async function openSwitcher(page: Page, count: number): Promise<void> {
  await page.getByRole('button', { name: `Open documents (${String(count)})` }).click();
  await expect(page.getByRole('searchbox', { name: 'Search open documents' })).toBeFocused({
    timeout: TIMEOUTS.ui,
  });
}

/** Dismiss the popover itself even when a tooltip owns the current keyboard focus. */
async function dismissSwitcher(page: Page): Promise<void> {
  const switcher = page.getByRole('dialog', { name: 'Open documents' });
  await switcher.press('Escape');
  await expect(switcher).toHaveCount(0);
}

/** Assert that the document has no viewport-level horizontal overflow. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

/** Return the rendered background color for a role's hover layer. */
async function colorRole(page: Page, className: string): Promise<string> {
  return page.evaluate((roleClass) => {
    const probe = document.createElement('span');
    probe.className = roleClass;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, className);
}

test('the open-document switcher stays dense, reachable, and touch-safe', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`${message.text()} (${message.location().url})`);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });

  const { orgId } = await signUpAndOnboard(page, 'OpenDocumentSwitcher');
  const session = await apiFetch(page, '/api/auth/get-session');
  expect(session.status).toBe(200);
  const userId = (session.body as { user?: { id?: string } }).user?.id;
  expect(userId, 'the authenticated session should expose its user id').toBeTruthy();
  if (!userId) throw new Error('The authenticated session did not expose a user id.');

  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding did not create a team for the active task.');
  const taskId = await createTask(page, orgId, teamId);
  const backgroundTaskIds: string[] = [];
  for (const title of BACKGROUND_TITLES) {
    const backgroundTask = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title, teamId },
    });
    backgroundTaskIds.push(backgroundTask.id);
  }
  const tabs = persistedTabs(orgId, taskId, backgroundTaskIds);
  await seedTabs(page, userId, tabs);
  await page.goto(orgHref(orgId, `tasks/${taskId}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: ACTIVE_TITLE })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setColorScheme(page, 'light');
  await openSwitcher(page, 13);
  consoleErrors.length = 0;
  const switcher = page.getByRole('dialog', { name: 'Open documents' });
  const results = switcher.getByRole('list', { name: 'Open document results' });
  const activeRow = results.getByRole('listitem', { name: ACTIVE_TITLE });
  const activeLink = activeRow.getByRole('link', { name: ACTIVE_TITLE });
  const activeClose = activeRow.getByRole('button', { name: `Close ${ACTIVE_TITLE}` });
  const backgroundTitle = backgroundTitleAt(0);
  const backgroundRow = results.getByRole('listitem', { name: backgroundTitle });
  const backgroundClose = backgroundRow.getByRole('button', { name: `Close ${backgroundTitle}` });

  expect(
    await switcher.evaluate((node) =>
      ['w-88', 'lg:w-[min(480px,calc(100vw-1.5rem))]'].every((name) =>
        node.classList.contains(name),
      ),
    ),
  ).toBe(true);
  expect(
    await activeRow.evaluate((node) =>
      ['h-11', 'min-h-11', 'py-0'].every((name) => node.classList.contains(name)),
    ),
  ).toBe(true);
  expect(await results.evaluate((node) => node.classList.contains('max-h-80'))).toBe(true);
  const desktopWidth = (await switcher.boundingBox())?.width ?? 0;
  // Radix collision keeps a 12px viewport gutter, which can shave up to 6px from this end-aligned
  // overlay. The exact 480px authored cap is asserted above; this checks its live rendered range.
  expect(desktopWidth).toBeGreaterThanOrEqual(474);
  expect(desktopWidth).toBeLessThanOrEqual(480);
  const rowHeight = (await activeRow.boundingBox())?.height ?? 0;
  // Chromium reports the transformed shell's 44px line at fractional device pixels.
  expect(rowHeight).toBeGreaterThanOrEqual(43);
  expect(rowHeight).toBeLessThanOrEqual(44);
  const resultHeight = (await results.boundingBox())?.height ?? 0;
  // The same device-pixel transform applies to the 320px max-height scroll region.
  expect(resultHeight).toBeGreaterThanOrEqual(318);
  expect(resultHeight).toBeLessThanOrEqual(320);
  await expect(results.getByRole('listitem')).toHaveCount(13);
  expect(
    Number.parseFloat(await activeClose.evaluate((node) => getComputedStyle(node).opacity)),
  ).toBe(0);

  const finalRow = results.getByRole('listitem', { name: backgroundTitleAt(11) });
  await finalRow.scrollIntoViewIfNeeded();
  const [listBounds, finalBounds] = await Promise.all([
    results.boundingBox(),
    finalRow.boundingBox(),
  ]);
  expect((finalBounds?.y ?? 0) + (finalBounds?.height ?? 0)).toBeLessThanOrEqual(
    (listBounds?.y ?? 0) + (listBounds?.height ?? 0) + 1,
  );

  await activeRow.hover();
  await expect(activeClose).toHaveCSS('opacity', '1');
  await expect(page.getByRole('tooltip').filter({ hasText: ACTIVE_TITLE })).toBeVisible();
  await activeClose.hover();
  await activeClose.focus();
  await expect(
    page.getByRole('tooltip').filter({ hasText: `Close ${ACTIVE_TITLE}` }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(SHOT_ROOT, 'switcher-close-hover-1440x900-light.png'),
  });

  const selectedExpected = await colorRole(page, 'bg-on-tertiary-container/8');
  const unselectedExpected = await colorRole(page, 'bg-on-surface/8');
  const selectedHover = await activeClose
    .locator('[data-menu-action-layer]')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await backgroundRow.hover();
  await expect(backgroundClose).toHaveCSS('opacity', '1');
  await backgroundClose.hover();
  const unselectedHover = await backgroundClose
    .locator('[data-menu-action-layer]')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(selectedHover).toBe(selectedExpected);
  expect(unselectedHover).toBe(unselectedExpected);

  const search = switcher.getByRole('searchbox', { name: 'Search open documents' });
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(activeLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(activeClose).toBeFocused();
  expect(
    Number.parseFloat(await activeClose.evaluate((node) => getComputedStyle(node).opacity)),
  ).toBe(1);
  await page.screenshot({
    path: resolve(SHOT_ROOT, 'switcher-keyboard-focus-1440x900-light.png'),
  });
  await search.focus();
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: resolve(SHOT_ROOT, 'switcher-1440x900-light.png') });

  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'switcher-1440x900-dark.png') });
  await setColorScheme(page, 'light');

  await search.fill('12');
  const finalTitle = backgroundTitleAt(11);
  await expect(results.getByRole('link', { name: finalTitle })).toBeVisible();
  const finalClose = results.getByRole('button', { name: `Close ${finalTitle}` });
  await results.getByRole('listitem', { name: finalTitle }).hover();
  await finalClose.click();
  await expect(results.getByRole('link', { name: finalTitle })).toHaveCount(0);
  await expect(search).toBeFocused();

  await dismissSwitcher(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openSwitcher(page, 12);
  const narrowWidth = (await switcher.boundingBox())?.width ?? 0;
  // The compact 352px rule remains intact, while collision keeps the 12px edge gutter on a phone.
  expect(narrowWidth).toBeGreaterThanOrEqual(338);
  expect(narrowWidth).toBeLessThanOrEqual(352);
  await setColorScheme(page, 'light');
  const narrowLongTitle = results.getByRole('listitem', { name: LONG_BACKGROUND_TITLE });
  const narrowLongTitleText = narrowLongTitle.locator('span.truncate');
  await expect(narrowLongTitleText).toHaveText(LONG_BACKGROUND_TITLE);
  const narrowTitleMetrics = await narrowLongTitleText.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(narrowTitleMetrics.scrollWidth).toBeGreaterThan(narrowTitleMetrics.clientWidth);
  await narrowLongTitle.getByRole('link', { name: LONG_BACKGROUND_TITLE }).hover();
  await expect(page.getByRole('tooltip')).toHaveText(LONG_BACKGROUND_TITLE);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: resolve(SHOT_ROOT, 'switcher-390x844-light.png') });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_ROOT, 'switcher-390x844-dark.png') });
  await dismissSwitcher(page);

  await page.setViewportSize({ width: 320, height: 720 });
  await openSwitcher(page, 12);
  await expectNoHorizontalOverflow(page);
  await dismissSwitcher(page);

  const storageState = await page.context().storageState();
  const touchContext = await browser.newContext({
    baseURL: ORIGIN,
    storageState,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const touchPage = await touchContext.newPage();
  const touchErrors: string[] = [];
  touchPage.on('console', (message) => {
    if (message.type() === 'error') {
      touchErrors.push(`${message.text()} (${message.location().url})`);
    }
  });
  touchPage.on('pageerror', (error) => touchErrors.push(error.message));
  await touchPage.goto(orgHref(orgId, `tasks/${taskId}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await seedTabs(touchPage, userId, tabs);
  await touchPage.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await expect(touchPage.getByRole('heading', { name: ACTIVE_TITLE })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await openSwitcher(touchPage, 13);
  touchErrors.length = 0;
  const coarseClose = touchPage
    .getByRole('list', { name: 'Open document results' })
    .getByRole('button', { name: `Close ${ACTIVE_TITLE}` });
  expect((await coarseClose.boundingBox())?.width).toBeCloseTo(40, 0);
  expect((await coarseClose.boundingBox())?.height).toBeCloseTo(40, 0);
  expect(
    Number.parseFloat(await coarseClose.evaluate((node) => getComputedStyle(node).opacity)),
  ).toBe(1);
  await touchContext.close();

  expect(consoleErrors).toEqual([]);
  expect(touchErrors).toEqual([]);
});
