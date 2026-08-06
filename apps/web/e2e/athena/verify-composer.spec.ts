/**
 * Create-task composer smoke + visual capture.
 *
 * Signs up a throwaway account, mints a personal workspace, opens the New task composer, and
 * attaches light/dark/discard screenshots as test artifacts. Asserts the composer actually opens
 * (so a broken flow fails the run); the screenshots are for human review.
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
