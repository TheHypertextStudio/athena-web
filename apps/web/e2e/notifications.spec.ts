/**
 * E2E: notification preferences and contact points are manageable from the settings UI.
 */
import { signUpAndOnboard } from './helpers/app';
import { TIMEOUTS, settingsHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { waitForApiResponse } from './helpers/net';

test.describe('notification settings', () => {
  test('lets a user manage channels and contact points', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'Notifications');

    await page.goto(settingsHref(orgId, 'notifications'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({
      timeout: TIMEOUTS.ui,
    });
    await expect(page.locator('section[aria-label="Notification preferences"]')).toBeVisible({
      timeout: TIMEOUTS.ui,
    });

    const digestEmail = page.getByRole('checkbox', { name: 'Email for Digests' });
    await expect(digestEmail).not.toBeChecked();
    const channelPatch = waitForApiResponse(page, /\/v1\/me\/notification-preferences(\?|$)/, {
      method: 'PATCH',
    });
    await digestEmail.click();
    expect((await channelPatch).status()).toBe(200);
    await expect(digestEmail).toBeChecked({ timeout: TIMEOUTS.ui });

    const quietHours = page.getByRole('checkbox', { name: 'Quiet hours' });
    await quietHours.check();
    await page.getByLabel('Quiet hours start').fill('19:00');
    await page.getByLabel('Quiet hours end').fill('07:00');
    const quietHoursPatch = waitForApiResponse(page, /\/v1\/me\/notification-preferences(\?|$)/, {
      method: 'PATCH',
    });
    await page.getByRole('button', { name: 'Save quiet hours' }).click();
    expect((await quietHoursPatch).status()).toBe(200);
    await expect(quietHours).toBeChecked();

    const suffix = String(Date.now()).slice(-4);
    const phone = `+1702555${suffix}`;
    const contactCreate = waitForApiResponse(page, /\/v1\/me\/contact-points(\?|$)/, {
      method: 'POST',
    });
    await page.getByLabel('Phone number').fill(phone);
    await page.getByRole('button', { name: 'Add phone' }).click();
    expect((await contactCreate).status()).toBe(200);
    await expect(page.getByText(`+*******${suffix}`, { exact: true })).toBeVisible({
      timeout: TIMEOUTS.ui,
    });
    await expect(page.getByText('Verification pending')).toBeVisible();

    await page.goto('/inbox', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({
      timeout: TIMEOUTS.ui,
    });
    await expect(page.getByText('Inbox zero')).toBeVisible({ timeout: TIMEOUTS.ui });
    await expect(page.locator('main [role="alert"]').filter({ hasText: /\S/ })).toHaveCount(0);
  });
});
