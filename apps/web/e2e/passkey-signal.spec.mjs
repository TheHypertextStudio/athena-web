/**
 * E2E: sign-in prunes a server-deleted passkey via the WebAuthn Signal API.
 *
 * Registers a passkey (sign-up) on the virtual authenticator, deletes it server-side via the
 * session-protected endpoint, signs out, and attempts passkey sign-in — then asserts the server
 * rejects with 401 PASSKEY_NOT_FOUND AND the app calls
 * `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })` with the deleted
 * credential. The credential lives only in the virtual authenticator, so registration and sign-in
 * share the one test `page` (and its context).
 */
import { newUser, signUp } from './helpers/app.mjs';
import { expect, test } from './helpers/fixtures.mjs';
import { installSignalSpy } from './helpers/webauthn.mjs';

const EXPECTED_RP_ID = process.env['PASSKEY_RP_ID'] ?? 'docket.localhost';

/** Fetch the signed-in user's passkeys from the page (carries the session cookie). */
async function listPasskeys(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/passkey/list-user-passkeys', {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`list-user-passkeys ${res.status}`);
    return res.json();
  });
}

test('sign-in prunes a server-deleted passkey via the WebAuthn Signal API', async ({ page }) => {
  // 1. Register a passkey via the real sign-up ceremony (warm-up + retries handled by signUp).
  await signUp(page, newUser('PasskeySignal'));

  // 2. Capture the registered credential, then delete the passkey server-side.
  const before = await listPasskeys(page);
  expect(Array.isArray(before) && before.length, 'expected a registered passkey').toBeTruthy();
  const credentialId = before[0].credentialID;
  const passkeyRowId = before[0].id;
  expect(credentialId, 'passkey row missing credentialID').toBeTruthy();
  expect(passkeyRowId, 'passkey row missing id').toBeTruthy();

  const deleteStatus = await page.evaluate(async (id) => {
    const res = await fetch('/api/auth/passkey/delete-passkey', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    return res.status;
  }, passkeyRowId);
  expect(deleteStatus, 'delete-passkey should succeed').toBeGreaterThanOrEqual(200);
  expect(deleteStatus).toBeLessThan(300);
  expect(await listPasskeys(page), 'passkey was not deleted server-side').toHaveLength(0);

  // 3. Sign out, install the Signal spy, and attempt sign-in with the now-stale credential.
  await page.context().clearCookies();
  await installSignalSpy(page);

  let verifyStatus = null;
  page.on('response', (res) => {
    if (/\/passkey\/verify-authentication(\?|$)/.test(res.url())) verifyStatus = res.status();
  });
  await page.goto('/sign-in', { waitUntil: 'networkidle' });
  const signInBtn = page.getByRole('button', { name: 'Sign in with a passkey' });
  for (let attempt = 0; attempt < 4 && verifyStatus === null; attempt++) {
    await signInBtn.click();
    for (let i = 0; i < 20 && verifyStatus === null; i++) await page.waitForTimeout(500);
  }
  expect(verifyStatus, 'verify-authentication never fired').not.toBeNull();
  expect(verifyStatus, 'expected verify-authentication 401 (PASSKEY_NOT_FOUND)').toBe(401);

  // The app told the browser to prune the stale credential, with the right args.
  const signalCalls = await page.evaluate(() => window.signalCalls ?? []);
  const match = signalCalls.find(
    (c) => c && c.rpId === EXPECTED_RP_ID && c.credentialId === credentialId,
  );
  expect(
    match,
    `signalUnknownCredential not called with { rpId: '${EXPECTED_RP_ID}', credentialId: '${credentialId}' }; calls=${JSON.stringify(signalCalls)}`,
  ).toBeTruthy();
});
