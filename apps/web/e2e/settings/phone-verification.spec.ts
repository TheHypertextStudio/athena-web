/** A local-provider journey through phone verification and reload recovery. */
import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('a person verifies a phone number after one wrong code', async ({ page }) => {
  await signUpAndOnboard(page, 'PhoneVerification');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/settings/athena', { waitUntil: 'domcontentloaded' });

  const section = page.locator('[data-phone-numbers-section]');
  const number = section.locator('[data-phone-field="national-number"]');
  await expect(number).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await number.fill('4155550198');
  await section.locator('[data-phone-action="bind"]').click();

  const code = section.locator('[data-phone-field="code"]');
  await expect(code).toBeFocused();
  await code.fill('000000');
  await section.locator('[data-phone-action="verify"]').click();
  await expect(section.getByRole('alert')).toBeVisible();

  await code.fill('123456');
  await section.locator('[data-phone-action="verify"]').click();
  await expect(section.getByText('Verified', { exact: true })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(section.getByText('Verified', { exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
