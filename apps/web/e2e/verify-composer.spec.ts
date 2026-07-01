/**
 * Create-task composer smoke + visual capture.
 *
 * Signs up a throwaway account, mints a personal workspace, opens the New task composer, and
 * attaches light/dark/discard screenshots as test artifacts. Asserts the composer actually opens
 * (so a broken flow fails the run); the screenshots are for human review.
 */
import { signUpAndOnboard } from './helpers/app';
import { myWorkHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { attachShot } from './helpers/ui';

test.describe('new-task composer', () => {
  test('opens and renders (light, dark, discard)', async ({ page }, testInfo) => {
    const { orgId } = await signUpAndOnboard(page, 'Composer');

    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
    await page
      .getByRole('button', { name: 'New task' })
      .first()
      .evaluate((button) => {
        (button as HTMLButtonElement).click();
      });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByPlaceholder('Task title')).toBeVisible();
    await page.waitForTimeout(400); // let the open animation settle
    await attachShot(testInfo, dialog, 'composer-light.png');

    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(250);
    await attachShot(testInfo, dialog, 'composer-dark.png');
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });

    await dialog.getByPlaceholder('Task title').fill('Ship the launch page');
    await dialog
      .getByPlaceholder('Add a description…')
      .fill('Draft copy + hero, then hand to design.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await attachShot(testInfo, dialog, 'composer-discard.png');
  });
});
