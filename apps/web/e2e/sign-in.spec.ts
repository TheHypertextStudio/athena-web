/**
 * E2E: returning passkey users can sign in and immediately call authenticated app APIs.
 */
import { newUser, signOut, signUp } from './helpers/app';
import { TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiFetch } from './helpers/net';

test.describe('passkey sign-in', () => {
  test('returns to onboarding with a readable session after passkey sign-in', async ({ page }) => {
    // This spec covers the explicit button ceremony. Without this override, Chromium's conditional
    // UI can auto-select the virtual credential and navigate before Playwright reaches the button.
    await page.addInitScript(() => {
      if (!('PublicKeyCredential' in window)) return;
      Object.defineProperty(window.PublicKeyCredential, 'isConditionalMediationAvailable', {
        configurable: true,
        value: async () => false,
      });
    });

    await signUp(page, newUser('SignIn'));
    await signOut(page);

    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: 'Sign in with a passkey' });
    await expect(button).toBeEnabled({ timeout: TIMEOUTS.ui });
    await button.click();

    await page.waitForURL('**/onboarding**', { timeout: TIMEOUTS.ceremony });
    const orgs = await apiFetch(page, '/v1/orgs');

    expect(orgs.status).toBe(200);
    expect(orgs.body).toEqual({ items: [] });
    await expect(page.getByText('We could not finish signing you in.')).toHaveCount(0);
  });
});
