/**
 * Create-task composer smoke + visual capture.
 *
 * Signs up a throwaway account, mints a personal workspace, opens the New task composer, and
 * attaches light/dark/discard screenshots as test artifacts. It also checks the compact and
 * expanded geometry plus real wheel scrolling, so shell overflow regressions fail in the browser.
 */
import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { attachShot, setColorScheme } from '../helpers/ui';

test.describe('new-task composer', () => {
  test('opens and renders (light, dark, discard)', async ({ page }, testInfo) => {
    const { orgId } = await signUpAndOnboard(page, 'Composer');

    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();

    const dialog = page.getByRole('dialog');
    const newTaskButton = page.getByRole('button', { name: 'New task' }).first();
    // `domcontentloaded` — and the heading check above, which is satisfied by the server-rendered
    // HTML alone — both resolve before React has necessarily finished hydrating and attached this
    // button's click handler. A click that lands in that gap is silently dropped: nothing throws,
    // the dialog just never opens. Retrying the click (not just the wait) recovers once hydration
    // has genuinely caught up, instead of waiting out the full timeout on a click that already
    // missed its target.
    await expect(async () => {
      await newTaskButton.click();
      await expect(dialog.getByPlaceholder('Task title')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: TIMEOUTS.pageReady });
    await page.waitForTimeout(400); // let the open animation settle

    const editor = dialog.locator('[contenteditable="true"][aria-label="Add a description…"]');
    const editorSurface = dialog.locator('[data-editor-surface]').first();
    const title = dialog.getByPlaceholder('Task title');
    const createButton = dialog.getByRole('button', { name: 'Create task' });
    await editor.evaluate((node) => {
      node.setAttribute('data-continuity-probe', 'same-editor');
    });
    const compact = await dialog.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        height: node.getBoundingClientRect().height,
        maxWidth: Number.parseFloat(style.maxWidth),
        overflowY: style.overflowY,
        rootSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        width: node.getBoundingClientRect().width,
      };
    });
    expect(compact.maxWidth).toBeCloseTo(compact.rootSize * 42, 0);
    expect(compact.width).toBeLessThanOrEqual(compact.maxWidth + 1);
    expect(compact.overflowY).toBe('hidden');

    await dialog.getByRole('button', { name: 'Expand editor' }).click();
    await expect(dialog.getByRole('button', { name: 'Collapse editor' })).toBeVisible();
    await page.waitForTimeout(250);
    const expanded = await dialog.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        height: node.getBoundingClientRect().height,
        maxWidth: Number.parseFloat(style.maxWidth),
        overflowY: style.overflowY,
        viewportHeight: window.innerHeight,
        width: node.getBoundingClientRect().width,
      };
    });
    expect(expanded.maxWidth).toBeCloseTo(compact.rootSize * 64, 0);
    expect(expanded.width).toBeGreaterThan(compact.width);
    expect(expanded.height).toBeGreaterThan(compact.height);
    expect(expanded.height).toBeLessThanOrEqual(expanded.viewportHeight * 0.85 + 1);
    expect(expanded.overflowY).toBe('hidden');
    await expect(editor).toHaveAttribute('data-continuity-probe', 'same-editor');

    const longDraft = Array.from(
      { length: 60 },
      (_, index) => `Line ${index + 1}: keep the dialog chrome fixed while this editor scrolls.`,
    ).join('\n');
    await editor.fill(longDraft);
    await expect
      .poll(() =>
        editorSurface.evaluate((node) => ({
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        })),
      )
      .toMatchObject({
        clientHeight: expect.any(Number),
        scrollHeight: expect.any(Number),
      });
    const scrollMetrics = await editorSurface.evaluate((node) => {
      const style = getComputedStyle(node);
      node.scrollTop = 0;
      return {
        clientHeight: node.clientHeight,
        overscrollBehaviorY: style.overscrollBehaviorY,
        scrollHeight: node.scrollHeight,
      };
    });
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(scrollMetrics.overscrollBehaviorY).toBe('contain');

    const fixedChromeBefore = await Promise.all([
      title.evaluate((node) => node.getBoundingClientRect().top),
      createButton.evaluate((node) => node.getBoundingClientRect().bottom),
      dialog.evaluate((node) => node.scrollTop),
      page.evaluate(() => window.scrollY),
    ]);
    await editorSurface.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => editorSurface.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const fixedChromeAfter = await Promise.all([
      title.evaluate((node) => node.getBoundingClientRect().top),
      createButton.evaluate((node) => node.getBoundingClientRect().bottom),
      dialog.evaluate((node) => node.scrollTop),
      page.evaluate(() => window.scrollY),
    ]);
    expect(fixedChromeAfter).toEqual(fixedChromeBefore);

    await editorSurface.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const chainBefore = await Promise.all([
      dialog.evaluate((node) => node.scrollTop),
      page.evaluate(() => window.scrollY),
    ]);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(100);
    const chainAfter = await Promise.all([
      dialog.evaluate((node) => node.scrollTop),
      page.evaluate(() => window.scrollY),
    ]);
    expect(chainAfter).toEqual(chainBefore);

    await dialog.getByRole('button', { name: 'Collapse editor' }).click();
    await expect(dialog.getByRole('button', { name: 'Expand editor' })).toBeVisible();
    await expect(editor).toHaveAttribute('data-continuity-probe', 'same-editor');
    await attachShot(testInfo, dialog, 'composer-light.png');

    await setColorScheme(page, 'dark');
    await page.waitForTimeout(250);
    await attachShot(testInfo, dialog, 'composer-dark.png');
    await setColorScheme(page, 'light');

    await dialog.getByPlaceholder('Task title').fill('Ship the launch page');
    await dialog
      .locator('[contenteditable="true"][aria-label="Add a description…"]')
      .fill('Draft copy + hero, then hand to design.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await attachShot(testInfo, dialog, 'composer-discard.png');
  });
});
