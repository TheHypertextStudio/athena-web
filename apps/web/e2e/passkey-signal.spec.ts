/**
 * E2E: sign-in prunes a server-deleted passkey via the WebAuthn Signal API.
 *
 * Registers a passkey (sign-up) on the virtual authenticator, deletes it server-side via the
 * session-protected endpoint, signs out, and attempts passkey sign-in — then asserts the server
 * rejects with 401 PASSKEY_NOT_FOUND AND the app calls
 * `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })` with the deleted credential.
 * The credential lives only in the virtual authenticator, so registration and sign-in share the one
 * test `page` (and its context).
 */
import { newUser, signOut, signUp } from './helpers/app';
import { RP_ID } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiFetch, apiJson, waitForApiResponse } from './helpers/net';
import { installSignalSpy } from './helpers/webauthn';

/** The passkey rows returned by `/api/auth/passkey/list-user-passkeys`. */
interface PasskeyRow {
  id: string;
  credentialID: string;
}

test.describe('passkey signal', () => {
  test('sign-in prunes a server-deleted passkey via the WebAuthn Signal API', async ({ page }) => {
    // 1. Register a passkey via the real sign-up ceremony (warm-up + retries handled by signUp).
    await signUp(page, newUser('PasskeySignal'));

    // 2. Capture the registered credential, then delete the passkey server-side.
    const before = await apiJson<PasskeyRow[]>(page, '/api/auth/passkey/list-user-passkeys');
    expect(before.length, 'expected a registered passkey').toBeGreaterThan(0);
    const { id: passkeyRowId, credentialID: credentialId } = before[0]!;
    expect(credentialId, 'passkey row missing credentialID').toBeTruthy();

    const del = await apiFetch(page, '/api/auth/passkey/delete-passkey', {
      method: 'POST',
      body: { id: passkeyRowId },
    });
    expect(del.status, 'delete-passkey should succeed').toBeGreaterThanOrEqual(200);
    expect(del.status).toBeLessThan(300);
    expect(
      await apiJson<PasskeyRow[]>(page, '/api/auth/passkey/list-user-passkeys'),
      'passkey was not deleted server-side',
    ).toHaveLength(0);

    // 3. Sign out, install the Signal spy, and attempt sign-in with the now-stale credential.
    await signOut(page);
    await installSignalSpy(page);

    const verifyP = waitForApiResponse(page, /\/passkey\/verify-authentication(\?|$)/);
    await page.goto('/sign-in', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
    const verify = await verifyP;
    expect(verify.status(), 'expected verify-authentication 401 (PASSKEY_NOT_FOUND)').toBe(401);

    // The app told the browser to prune the stale credential, with the right args.
    const signalCalls = (await page.evaluate(() => window.signalCalls ?? [])) as {
      rpId?: string;
      credentialId?: string;
    }[];
    const match = signalCalls.find((c) => c.rpId === RP_ID && c.credentialId === credentialId);
    expect(
      match,
      `signalUnknownCredential not called with { rpId: '${RP_ID}', credentialId: '${credentialId}' }; calls=${JSON.stringify(signalCalls)}`,
    ).toBeTruthy();
  });
});
