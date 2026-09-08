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
import { newUser, signOut, signUp } from '../helpers/app';
import { RP_ID } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch, apiJson, waitForApiResponse } from '../helpers/net';
import { installSignalSpy } from '../helpers/webauthn';
import { assertDefined } from '@docket/test-utils';

/** Safe passkey summary returned by `/v1/me/passkeys`. */
interface PasskeyRow {
  id: string;
}

test.describe('passkey signal', () => {
  test('sign-in prunes a server-deleted passkey via the WebAuthn Signal API', async ({ page }) => {
    // 1. Register a passkey via the real sign-up ceremony (warm-up + retries handled by signUp).
    await signUp(page, newUser('PasskeySignal'));

    // Deleting a user's only passkey is blocked server-side unless another recovery path exists
    // (see the typed passkey deletion guard) — generate recovery codes so
    // this test's deletion represents a real, allowed account state rather than a lockout attempt.
    // The just-completed sign-up ceremony leaves the session fresh enough for this step-up route.
    const codes = await apiFetch(page, '/v1/me/recovery-codes', { method: 'POST' });
    expect(codes.status, 'recovery-code generation should succeed').toBe(200);

    // 2. Capture the registered credential, then delete the passkey server-side.
    const before = await apiJson<{ items: PasskeyRow[] }>(page, '/v1/me/passkeys');
    expect(before.items.length, 'expected a registered passkey').toBeGreaterThan(0);
    const { id: passkeyRowId } = assertDefined(before.items[0]);

    const del = await apiJson<{ status: true; credentialId: string }>(
      page,
      `/v1/me/passkeys/${passkeyRowId}`,
      {
        method: 'DELETE',
      },
    );
    expect(del.status, 'delete-passkey should succeed').toBe(true);
    const { credentialId } = del;
    expect(credentialId, 'deletion response missing credentialId').toBeTruthy();
    expect(
      (await apiJson<{ items: PasskeyRow[] }>(page, '/v1/me/passkeys')).items,
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
