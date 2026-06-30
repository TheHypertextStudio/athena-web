/**
 * Recovery-codes e2e: generate backup codes, then recover a locked-out account with one.
 *
 * Drives the whole passwordless recovery story against the running dev stack, with the CDP virtual
 * authenticator auto-approving every passkey ceremony: sign up (passkey) → generate recovery codes
 * behind the passkey step-up → assert the one-time reveal is gated until the codes are saved → sign
 * out (simulate a lost passkey) → `/recover` with email + a code → verify with no passkey → enrol a
 * fresh passkey → land back in the app, signed in. Set `E2E_SHOT_DIR` to also capture before/after
 * stills (the reveal, the "you're back in" screen, the recovered home) into that directory.
 */
import path from 'node:path';

import { signUpAndOnboard } from './helpers/app.mjs';
import { expect, test } from './helpers/fixtures.mjs';
import { clearVirtualCredentials } from './helpers/webauthn.mjs';

/** Opt-in: when `E2E_SHOT_DIR` is set, capture before/after stills there; otherwise a no-op. */
const SHOT_DIR = process.env['E2E_SHOT_DIR'];
const shot = async (page, name) => {
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name) });
};

test('generate recovery codes, then recover a locked-out account', async ({ page }) => {
  const { user, orgId } = await signUpAndOnboard(page, 'Recovery');

  // ── Generate recovery codes (passkey step-up auto-approved by the virtual authenticator) ──
  await page.goto(`/orgs/${orgId}/settings/security`);
  await page.getByRole('button', { name: /Generate recovery codes/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Generate codes' }).click();

  // The one-time reveal shows ten numbered codes.
  const items = dialog.locator('ol li');
  await expect(items).toHaveCount(10, { timeout: 30_000 });

  // The reveal is gated: "Done" stays disabled until the user copies or downloads the codes.
  const done = dialog.getByRole('button', { name: 'Done' });
  await expect(done).toBeDisabled();
  await dialog.getByRole('button', { name: 'Download' }).click();
  await expect(done).toBeEnabled();
  await shot(page, 'recovery-1-codes.png');

  // Grab a code (strip the "N." index prefix) before dismissing — it's shown only once.
  const codes = (await items.allTextContents()).map((t) => t.replace(/^\s*\d+\.\s*/, '').trim());
  expect(codes[0], 'a code should match the xxxxx-xxxxx shape').toMatch(
    /^[a-zA-Z0-9]{5}-[a-zA-Z0-9]{5}$/,
  );
  await done.click();
  await expect(dialog).toBeHidden();

  // ── Lose the passkey: wipe the device's credential + sign out, so the only way back is a code ──
  await clearVirtualCredentials(page);
  await page.context().clearCookies();

  // ── Recover with a backup code ────────────────────────────────────────────────────────────
  await page.goto('/recover', { waitUntil: 'networkidle' });
  await page.fill('#email', user.email);
  await page.fill('#code', codes[0]);
  await page.getByRole('button', { name: 'Recover account' }).click();

  // Verified (no passkey) → the "you're back in" re-enrolment screen.
  await expect(page.getByText("You're back in")).toBeVisible({ timeout: 30_000 });
  await shot(page, 'recovery-2-back-in.png');

  // Enrol a fresh passkey (virtual authenticator) → land in the app, signed in again.
  await page.getByRole('button', { name: 'Add a new passkey' }).click();
  await page.waitForURL('**/today**', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'recovery-3-signed-in.png');

  // A used recovery code cannot be replayed: re-arming + re-verifying the same code now fails.
  await page.context().clearCookies();
  await page.goto('/recover', { waitUntil: 'networkidle' });
  await page.fill('#email', user.email);
  await page.fill('#code', codes[0]);
  await page.getByRole('button', { name: 'Recover account' }).click();
  await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/recover/);
});
