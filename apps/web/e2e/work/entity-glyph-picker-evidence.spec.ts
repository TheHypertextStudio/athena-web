/** Browser evidence for the shared entity icon and emoji picker. */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SESSION_PATH = resolve(process.env['GLYPH_SESSION'] ?? 'playwright/.auth/glyph-picker.json');
const SESSION_META = JSON.parse(readFileSync(`${SESSION_PATH}.meta.json`, 'utf8')) as {
  orgId: string;
};
const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-09-06-entity-glyph-picker',
);
const PROJECT_NAME = 'Transit launch workflow';

test.use({ serviceWorkers: 'block', storageState: SESSION_PATH });

/** Open the lazy picker and prove that it moves focus into search. */
async function openPicker(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: `Customize ${PROJECT_NAME} icon` });
  await trigger.click();
  const search = page.getByRole('searchbox', { name: /Search (icons|emoji)/ });
  await expect(search).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await expect(search).toBeFocused();
  await expectNoHorizontalHairlines(page);
}

/** Prove that picker hierarchy does not depend on horizontal rules. */
async function expectNoHorizontalHairlines(page: Page): Promise<void> {
  const regions = [
    page.getByTestId('entity-glyph-search-header'),
    page.getByRole('tablist', { name: 'Glyph catalog' }),
    page.getByTestId('entity-glyph-color-footer'),
  ];
  for (const region of regions) {
    const borders = await region.evaluate((element) => {
      const style = getComputedStyle(element);
      return { top: style.borderTopWidth, bottom: style.borderBottomWidth };
    });
    expect(borders).toEqual({ top: '0px', bottom: '0px' });
  }
  const activeTabClass =
    (await page
      .getByRole('tablist', { name: 'Glyph catalog' })
      .getByRole('tab', { selected: true })
      .getAttribute('class')) ?? '';
  expect(activeTabClass).not.toContain('after:h-');
}

/** Close the picker and prove that focus returns to its trigger. */
async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Customize ${PROJECT_NAME} icon` })).toBeFocused();
}

/** Save one review frame after the picker has settled. */
async function capture(page: Page, fileName: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOT_ROOT, fileName), caret: 'initial' });
}

test('icon and emoji search stays usable across the review matrix', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(SHOT_ROOT, { recursive: true });
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });

  await page.goto('/today', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${SESSION_META.orgId}/projects`, {
    method: 'POST',
    body: { name: PROJECT_NAME },
  });
  const projectHref = orgHref(SESSION_META.orgId, `projects/${project.id}`);
  await page.goto(projectHref, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await expect(page.getByRole('heading', { name: PROJECT_NAME })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await setColorScheme(page, 'light');
  await openPicker(page);
  const search = page.getByRole('searchbox', { name: 'Search icons' });
  await search.fill('rocket');
  await expect(page.getByRole('group', { name: 'Icon search results' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Emoji search results' })).toHaveCount(0);
  const firstIconResult = page
    .getByRole('group', { name: 'Icon search results' })
    .getByTestId('entity-glyph-option')
    .first();
  await firstIconResult.focus();
  await page.keyboard.press('ArrowRight');
  const secondIconResult = page
    .getByRole('group', { name: 'Icon search results' })
    .getByTestId('entity-glyph-option')
    .nth(1);
  await expect(secondIconResult).toBeFocused();
  await capture(page, 'picker-1440x900-light-icon-search.png');
  await closePicker(page);

  await apiJson(page, `/v1/orgs/${SESSION_META.orgId}/display/project/${project.id}`, {
    method: 'PUT',
    body: { glyph: { kind: 'emoji', hexcode: '1F680' }, colorKey: 'purple', customColor: null },
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await setColorScheme(page, 'dark');
  await openPicker(page);
  await page.getByRole('tab', { name: 'Emoji' }).click();
  await expect(page.getByRole('combobox', { name: 'Emoji category' })).toBeVisible();
  await page.getByRole('radio', { name: 'Medium skin tone' }).focus();
  await expect(page.getByRole('radio', { name: 'Medium skin tone' })).toBeFocused();
  await capture(page, 'picker-1440x900-dark-emoji-browse.png');
  await closePicker(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await setColorScheme(page, 'light');
  await openPicker(page);
  await page.getByRole('tab', { name: 'Icons' }).click();
  await expect(page.getByRole('group', { name: 'Suggested' })).toBeVisible();
  await capture(page, 'picker-390x844-light-suggestions.png');
  await closePicker(page);

  await setColorScheme(page, 'dark');
  await openPicker(page);
  await page.getByRole('tab', { name: 'Emoji' }).click();
  const emojiSearch = page.getByRole('searchbox', { name: 'Search emoji' });
  await emojiSearch.fill('a');
  await expect(page.getByRole('group', { name: 'Emoji search results' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Icon search results' })).toHaveCount(0);
  await capture(page, 'picker-390x844-dark-long-search.png');
  await closePicker(page);

  await page.setViewportSize({ width: 320, height: 844 });
  await setColorScheme(page, 'light');
  await openPicker(page);
  await page.getByRole('tab', { name: 'Icons' }).click();
  const mobileIconSearch = page.getByRole('searchbox', { name: 'Search icons' });
  await mobileIconSearch.fill('a');
  const picker = mobileIconSearch.locator('../..');
  const geometry = await picker.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      width: bounds.width,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(320);
  expect(geometry.width).toBeLessThanOrEqual(360);
  expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /^Choose color,/ }).click();
  const colorTargets = page.getByRole('radiogroup', { name: 'Entity color' }).getByRole('radio');
  const colorTargetBoxes = await colorTargets.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect()),
  );
  expect(colorTargetBoxes).toHaveLength(15);
  for (const target of colorTargetBoxes) {
    expect(target.width).toBeGreaterThanOrEqual(40);
    expect(target.height).toBeGreaterThanOrEqual(40);
    expect(target.left).toBeGreaterThanOrEqual(0);
    expect(target.right).toBeLessThanOrEqual(320);
  }
  await capture(page, 'picker-320x844-light-overflow.png');
  expect(browserErrors).toEqual([]);
});
