/** Daily planning enters and leaves an independent navigation context. */
import { captureDailyPlanningEvidence, setupPlan } from '../helpers/daily-planning';
import { expect, test } from '../helpers/fixtures';

test('an empty day opens Plan today before the separate available-work browser', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-empty', []);
  await page.goto(`/plan?view=day&date=${context.date}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`/plan/day?date=${context.date}`);
  await expect(page.getByRole('heading', { name: 'Plan today', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
  let releaseDay: () => void = () => undefined;
  const heldDay = new Promise<void>((resolve) => {
    releaseDay = resolve;
  });
  await page.route('**/v1/daily-plan/day/*', async (route) => {
    if (route.request().method() === 'GET') await heldDay;
    await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status', { name: 'Loading daily plan' })).toBeVisible();
  releaseDay();
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New task' }).click();
  const composer = page.getByRole('dialog', { name: 'New task', exact: true });
  await expect(composer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(composer).toBeHidden();
  await captureDailyPlanningEvidence(page, testInfo, 'add-work');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan today' })).toBeVisible();
  await page.locator('#main-content').evaluate((element) => {
    element.scrollTop = 300;
  });
  await page.getByRole('button', { name: 'Review plan', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Review plan', exact: true })).toBeVisible();
  await expect
    .poll(() => page.locator('#main-content').evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.getByRole('button', { name: 'Plan today', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tasks', exact: true })).toHaveCount(1);
  await page.getByRole('link', { name: 'Resume planning', exact: true }).click();
  await expect(page).toHaveURL(`/plan/day?date=${context.date}`);
  await expect(page.getByRole('heading', { name: 'Plan today', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeHidden();
  await captureDailyPlanningEvidence(page, testInfo, 'agenda-panel');
});
