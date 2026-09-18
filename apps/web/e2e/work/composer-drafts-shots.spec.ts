/**
 * Visual evidence for composer drafts: the close prompt, the Drafts chip's list, and the Drafts
 * page, at the two standard widths in both themes.
 *
 * @remarks
 * The prompt and the chip only exist while a composer is open with a draft in it, so a static
 * route capture cannot reach them. These tests drive the real composer and save the frames beside
 * a horizontal-overflow probe.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(process.cwd(), '.data/design-review/composer-drafts');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

/** Save a frame after fonts settle, with the Next.js dev overlay hidden. */
async function capture(page: Page, name: string): Promise<void> {
  await page.locator('nextjs-portal').evaluateAll((elements) => {
    for (const element of elements) (element as HTMLElement).style.display = 'none';
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOT_ROOT, name) });
}

/** Assert the page does not scroll sideways at this width. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.use({ serviceWorkers: 'block' });

test.describe('composer drafts visuals', () => {
  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      test(`prompt, chip, and page (${viewport.name}, ${scheme})`, async ({ page }) => {
        await mkdir(SHOT_ROOT, { recursive: true });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setColorScheme(page, scheme);
        const { orgId } = await signUpAndOnboard(page, `DraftShots${viewport.name}${scheme}`);
        await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();

        const dialog = page.getByRole('dialog');
        const newTask = page.getByRole('button', { name: 'New task' }).first();
        await expect(async () => {
          await newTask.click();
          await expect(dialog.getByPlaceholder('Task title')).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: TIMEOUTS.pageReady });
        await dialog.getByPlaceholder('Task title').fill('Draft the grant report for the board');
        const editor = dialog.locator('[contenteditable="true"][aria-label="Add a description"]');
        await editor.click();
        await page.keyboard.type('Outline the impact section and pull last quarter’s numbers.');

        // The close prompt.
        await page.keyboard.press('Escape');
        await expect(dialog.getByRole('button', { name: 'Save draft' })).toBeVisible();
        await capture(page, `${viewport.name}-${scheme}-1-close-prompt.png`);
        await expectNoHorizontalOverflow(page);
        await dialog.getByRole('button', { name: 'Save draft' }).click();
        await expect(dialog).toBeHidden();

        // A second draft with a long title, so the list shows truncation and column alignment.
        await expect(async () => {
          await newTask.click();
          await expect(dialog.getByPlaceholder('Task title')).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: TIMEOUTS.pageReady });
        await dialog
          .getByPlaceholder('Task title')
          .fill('Reconcile the second-quarter vendor invoices against the purchase orders');
        await page.keyboard.press('Escape');
        await dialog.getByRole('button', { name: 'Save draft' }).click();
        await expect(dialog).toBeHidden();

        // The chip's list inside a fresh composer.
        await expect(async () => {
          await newTask.click();
          await expect(dialog.getByPlaceholder('Task title')).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: TIMEOUTS.pageReady });
        await dialog.getByRole('button', { name: /^Drafts, 2/ }).click();
        await expect(page.getByRole('list', { name: 'Saved drafts' })).toBeVisible();
        await capture(page, `${viewport.name}-${scheme}-2-chip-list.png`);
        // Escape peels one layer at a time (the row's tooltip, the list, then the empty and so
        // unprompted composer), so press until the composer is gone.
        await expect(async () => {
          await page.keyboard.press('Escape');
          await expect(page.getByPlaceholder('Task title')).toBeHidden({ timeout: 750 });
        }).toPass({ timeout: TIMEOUTS.pageReady });

        // The Drafts page, populated.
        await page.goto('/drafts', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Drafts' })).toBeVisible({
          timeout: TIMEOUTS.pageReady,
        });
        await expect(page.getByRole('row', { name: /Draft the grant report/ })).toBeVisible();
        await capture(page, `${viewport.name}-${scheme}-3-drafts-page.png`);
        await expectNoHorizontalOverflow(page);
      });
    }
  }
});
