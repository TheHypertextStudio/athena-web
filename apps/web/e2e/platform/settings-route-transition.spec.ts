/**
 * Regression coverage for opening Settings from a persistent application layout.
 *
 * The account menu uses Next router navigation rather than a full document load. That distinction
 * matters because the layout keeps its original server path: the route slot must not mistake the
 * new Settings URL for a service-worker replay and show the offline fallback.
 */
import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test.describe('Settings route transition', () => {
  test('opens Profile from the account menu without the offline fallback', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'SettingsRouteTransition');

    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    const accountMenu = page.getByRole('button', { name: 'Account menu' });
    await expect(accountMenu).toBeVisible({ timeout: TIMEOUTS.pageReady });

    // The shell can be server-rendered before this menu's React handler is attached. Retry the
    // interaction itself so this test describes the user journey instead of a hydration race.
    await expect(async () => {
      await accountMenu.click();
      await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible({
        timeout: TIMEOUTS.ui,
      });
    }).toPass({ timeout: TIMEOUTS.pageReady });

    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/settings\/profile(?:\?.*)?$/, {
      timeout: TIMEOUTS.pageReady,
    });
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(dialog.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByText("Can't reach Docket", { exact: true })).toHaveCount(0);
  });
});
