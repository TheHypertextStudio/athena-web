/**
 * Create-task composer smoke + visual capture.
 *
 * Signs up a throwaway account, mints a personal workspace, opens the New task composer, and
 * attaches light/dark/discard screenshots as test artifacts. Asserts the composer actually opens
 * (so a broken flow fails the run); the screenshots are for human review.
 */
import { signUpAndOnboard } from './helpers/app.mjs';
import { expect, test } from './helpers/fixtures.mjs';

test('new-task composer opens and renders (light, dark, discard)', async ({ page }, testInfo) => {
  const { orgId } = await signUpAndOnboard(page, 'Composer');

  await page.goto(`/orgs/${orgId}/my-work`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
  await page.getByRole('button', { name: 'New task' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByPlaceholder('Task title')).toBeVisible();
  await page.waitForTimeout(400); // let the open animation settle
  await testInfo.attach('composer-light', { body: await dialog.screenshot(), contentType: 'image/png' });

  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(250);
  await testInfo.attach('composer-dark', { body: await dialog.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));

  await dialog.getByPlaceholder('Task title').fill('Ship the launch page');
  await dialog.getByPlaceholder('Add a description…').fill('Draft copy + hero, then hand to design.');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await testInfo.attach('composer-discard', { body: await dialog.screenshot(), contentType: 'image/png' });
});
