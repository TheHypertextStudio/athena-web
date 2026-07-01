/**
 * Recovery-codes e2e: generate backup codes, then recover a locked-out account with one.
 *
 * Drives the whole passwordless recovery story against the running dev stack, with the CDP virtual
 * authenticator auto-approving every passkey ceremony: sign up (passkey) → generate recovery codes
 * behind the passkey step-up → assert the one-time reveal is gated until the codes are saved → lose
 * the device → `/recover` with email + a code → verify with no passkey → enrol a fresh passkey →
 * land back in the app, signed in; and a used code can't be replayed. Before/after stills are
 * attached to the report.
 */
import { loseDevice, signOut, signUpAndOnboard } from './helpers/app';
import { TIMEOUTS, settingsHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { attachShot, expectAlert } from './helpers/ui';

test.describe('recovery codes', () => {
  test('generate recovery codes, then recover a locked-out account', async ({ page }, testInfo) => {
    const { user, orgId } = await signUpAndOnboard(page, 'Recovery');

    // ── Generate recovery codes (passkey step-up auto-approved by the virtual authenticator) ──
    await page.goto(settingsHref(orgId, 'security'));
    await page.getByRole('button', { name: /Generate recovery codes/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Generate codes' }).click();

    // The one-time reveal shows ten numbered codes.
    const items = dialog.locator('ol li');
    await expect(items).toHaveCount(10, { timeout: TIMEOUTS.ceremony });

    // The reveal is gated: "Done" stays disabled until the user copies or downloads the codes.
    const done = dialog.getByRole('button', { name: 'Done' });
    await expect(done).toBeDisabled();
    await dialog.getByRole('button', { name: 'Download' }).click();
    await expect(done).toBeEnabled();
    await attachShot(testInfo, page, 'recovery-1-codes.png');

    // Grab a code (strip the "N." index prefix) before dismissing — it's shown only once.
    const codes = (await items.allTextContents()).map((t) => t.replace(/^\s*\d+\.\s*/, '').trim());
    expect(codes[0], 'a code should match the xxxxx-xxxxx shape').toMatch(
      /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/,
    );
    await done.click();
    await expect(dialog).toBeHidden();

    // ── Lose the device (wipe the passkey + sign out), so the only way back is a recovery code ──
    await loseDevice(page);

    // ── Recover with a backup code ──────────────────────────────────────────────────────────
    await page.goto('/recover', { waitUntil: 'networkidle' });
    await page.fill('#email', user.email);
    await page.fill('#code', codes[0]!);
    await page.getByRole('button', { name: 'Recover account' }).click();

    // Verified (no passkey) → the "you're back in" re-enrolment screen.
    await expect(page.getByText("You're back in")).toBeVisible({ timeout: TIMEOUTS.ceremony });
    await attachShot(testInfo, page, 'recovery-2-back-in.png');

    // Enrol a fresh passkey (virtual authenticator) → land in the app, signed in again.
    await page.getByRole('button', { name: 'Add a new passkey' }).click();
    await page.waitForURL('**/today**', { timeout: TIMEOUTS.ceremony });
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({
      timeout: TIMEOUTS.ceremony,
    });
    await attachShot(testInfo, page, 'recovery-3-signed-in.png');

    // A used recovery code cannot be replayed: signing out and re-verifying the same code fails.
    await signOut(page);
    await page.goto('/recover', { waitUntil: 'networkidle' });
    await page.fill('#email', user.email);
    await page.fill('#code', codes[0]!);
    await page.getByRole('button', { name: 'Recover account' }).click();
    await expectAlert(page).toBeVisible({ timeout: TIMEOUTS.ceremony });
    await expect(page).toHaveURL(/\/recover/);
  });
});
