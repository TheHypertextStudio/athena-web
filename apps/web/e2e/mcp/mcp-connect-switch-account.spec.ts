/**
 * MCP e2e — "Not you? Switch account" on the OAuth consent screen.
 *
 * @remarks
 * The consent screen shows which account a client is requesting access as, but had no way to
 * change it short of abandoning the request and starting over. This covers the full contract: a
 * deliberate sign-out that preserves the pending authorization request as `?callbackURL=`, and
 * that the resumed sign-in actually lands back on the same request rather than losing it.
 *
 * The test user is onboarded (`signUpAndOnboard`), not merely signed up. `routeAfterSignIn`
 * (`apps/web/src/app/(auth)/sign-in/sign-in-client.tsx`) only honors `callbackURL` once a person
 * has at least one org — a zero-org account is routed to `/onboarding` unconditionally, before
 * `callbackURL` is ever read. That's a real, separately-tracked gap in the shared resume path,
 * not something this control can paper over, so this spec sidesteps it the way a person actually
 * using this control would: they already have an account to switch *to*.
 *
 * `addInitScript` disables conditional-mediation (autofill) WebAuthn before any navigation.
 * Without it, the sign-in page's passive autofill request and this test's explicit click both
 * race to complete the same ceremony against the virtual authenticator — the same class of race
 * `mcp-connect-cold-start.spec.ts` works around with `Promise.race` and `sign-in.spec.ts` works
 * around the same way this file does; two mitigations for one root cause already exist in this
 * suite, and this is the second file that needs the explicit-click one specifically.
 */
import { startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { discover, exchangeCode, MCP_URL, REDIRECT_URI, registerClient } from '../helpers/mcp';

test('"Not you? Switch account" signs out and resumes the same authorization request', async ({
  page,
}) => {
  // See the module remarks: without this, the sign-in page's own autofill can win the race
  // against this test's explicit passkey-button click.
  await page.addInitScript(() => {
    if (!('PublicKeyCredential' in window)) return;
    Object.defineProperty(window.PublicKeyCredential, 'isConditionalMediationAvailable', {
      configurable: true,
      value: async () => false,
    });
  });

  // Onboarded, not just signed up: the realistic case for this control is an existing person
  // switching to the account they meant to use, not someone mid-signup.
  const { user } = await signUpAndOnboard(page, 'McpSwitchAccount');

  const discovery = await discover();
  const clientId = await registerClient(discovery, 'Docket E2E Switch-Account Client');
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    discovery.authorizationServerUrl,
    {
      metadata: discovery.metadata,
      clientInformation: { client_id: clientId },
      redirectUrl: REDIRECT_URI,
      scope: 'work:read',
      resource: new URL(MCP_URL),
    },
  );

  // Already signed in, so this lands directly on consent — no sign-in hop yet.
  await page.goto(authorizationUrl.pathname + authorizationUrl.search);
  const allowAccess = page.getByRole('button', { name: 'Allow access' });
  await expect(allowAccess).toBeVisible({ timeout: TIMEOUTS.ceremony });
  await expect(page.getByText(user.email)).toBeVisible();

  await page.getByRole('button', { name: 'Not you? Switch account' }).click();

  // Signed out and bounced to sign-in with THIS exact request preserved via `?callbackURL=`,
  // not the raw-query shape the server's own forced sign-out uses (see `mcp-connect-cold-start.
  // spec.ts`) — both paths must resume, but this is the one this control is responsible for.
  const signInWithPasskey = page.getByRole('button', { name: 'Sign in with a passkey' });
  await expect(signInWithPasskey).toBeVisible({ timeout: TIMEOUTS.ceremony });
  const signInUrl = new URL(page.url());
  expect(signInUrl.pathname).toBe('/sign-in');
  const callbackURL = signInUrl.searchParams.get('callbackURL');
  expect(callbackURL, 'the original authorization request must survive as callbackURL').toContain(
    `client_id=${clientId}`,
  );

  await signInWithPasskey.click();

  // Back on the SAME consent request, not dropped to onboarding or the app's home destination.
  await expect(allowAccess).toBeVisible({ timeout: TIMEOUTS.ceremony });
  await expect(page.getByText(user.email)).toBeVisible();

  // The resumed session is real, not just visually present — finish the grant and exchange it.
  await allowAccess.click();
  await page.waitForURL(`${REDIRECT_URI}*`, { timeout: TIMEOUTS.ceremony });
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get('error')).toBeNull();
  const code = redirected.searchParams.get('code');
  expect(code, 'authorize redirect must carry a code').toBeTruthy();
  if (!code) throw new Error('authorize redirect must carry a code');

  const { accessToken } = await exchangeCode(discovery, { clientId, code, codeVerifier });
  expect(accessToken).toBeTruthy();
});
