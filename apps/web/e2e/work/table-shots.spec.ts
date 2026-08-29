/**
 * Visual and keyboard evidence for the shared Markdown table editor.
 *
 * @remarks
 * The table controls only exist while a real table cell owns the selection, so a static route
 * capture cannot reach this state. These tests use the real task composer and save the four
 * standard design-review frames beside a 320px overflow probe.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(process.cwd(), '.data/design-review/editor-tables');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const TABLE_TSV = `Format\tPaste\tCopy\tFidelity
Markdown\tYes\tYes\tCanonical
HTML\tYes\tYes\tRich
CSV\tExplicit\tYes\tCells
TSV\tYes\tYes\tCells`;

async function capture(page: Page, name: string): Promise<void> {
  await page.locator('nextjs-portal').evaluateAll((elements) => {
    for (const element of elements) (element as HTMLElement).style.display = 'none';
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SHOT_ROOT, name) });
}

// The evidence flow verifies a live composer. The PWA cache belongs to the offline suite and can
// otherwise replace its newly created workspace with the offline interlock before the capture.
test.use({ serviceWorkers: 'block' });

test.describe('Markdown table visuals', () => {
  for (const viewport of VIEWPORTS) {
    test(`contextual controls (${viewport.name})`, async ({ page }) => {
      await mkdir(SHOT_ROOT, { recursive: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const { orgId } = await signUpAndOnboard(page, `TableShot${viewport.name}`);

      await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
      const dialog = page.getByRole('dialog');
      const newTaskButton = page.getByRole('button', { name: 'New task' }).first();
      await expect(async () => {
        await newTaskButton.click();
        await expect(dialog.getByPlaceholder('Task title')).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: TIMEOUTS.pageReady });
      await dialog.getByPlaceholder('Task title').fill('Markdown table exchange');

      const editor = dialog.locator('[contenteditable="true"][aria-label="Add a description"]');
      await expect(editor).toBeVisible({ timeout: TIMEOUTS.pageReady });
      await editor.evaluate((node, text) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', text);
        node.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
        );
      }, TABLE_TSV);
      await expect(editor.locator('table')).toBeVisible();
      await editor.locator('th').filter({ hasText: 'Format' }).click();

      const toolbar = page.getByRole('toolbar', { name: 'Table controls' });
      await expect(toolbar).toBeVisible();
      const tableOptions = toolbar.getByRole('button', { name: 'Table options' });
      await expect(tableOptions).toBeVisible();
      const tableOptionsBox = await tableOptions.boundingBox();
      expect(tableOptionsBox).not.toBeNull();
      expect(tableOptionsBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((tableOptionsBox?.x ?? 0) + (tableOptionsBox?.width ?? 0)).toBeLessThanOrEqual(
        viewport.width,
      );
      await setColorScheme(page, 'light');
      await capture(page, `${viewport.name}-light.png`);
      await setColorScheme(page, 'dark');
      await capture(page, `${viewport.name}-dark.png`);

      await setColorScheme(page, 'light');
      await editor.locator('th').filter({ hasText: 'Format' }).click();
      await page.keyboard.press('Alt+F10');
      await expect(toolbar.getByRole('button', { name: 'Add row' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(editor).toBeFocused();
      await expect(page.getByText('Discard this draft?')).toBeHidden();

      if (viewport.name === 'mobile') {
        await page.setViewportSize({ width: 320, height: 720 });
        await editor.locator('th').filter({ hasText: 'Format' }).click();
        await expect(toolbar).toBeVisible();
        await expect(tableOptions).toBeVisible();
        await expect(toolbar.getByRole('button', { name: 'Add column' })).toBeHidden();

        const optionsCanReceivePointer = await tableOptions.evaluate((button) => {
          const box = button.getBoundingClientRect();
          const target = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return target === button || button.contains(target);
        });
        expect(optionsCanReceivePointer).toBe(true);
        await tableOptions.click();
        await expect(page.getByRole('menuitem', { name: 'Add column' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menuitem', { name: 'Add column' })).toBeHidden();
        await expect(page.getByText('Discard this draft?')).toBeHidden();

        const geometry = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth);

        const toolbarBox = await toolbar.boundingBox();
        expect(toolbarBox).not.toBeNull();
        expect(toolbarBox?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((toolbarBox?.x ?? 0) + (toolbarBox?.width ?? 0)).toBeLessThanOrEqual(320);

        const controls = toolbar.locator('button:visible');
        for (let index = 0; index < (await controls.count()); index += 1) {
          const box = await controls.nth(index).boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
        }
        await capture(page, 'mobile-320-overflow.png');
      }
    });
  }
});
