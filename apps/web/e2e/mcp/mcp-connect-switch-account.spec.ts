/**
 * MCP e2e — "Not you? Switch account" on the OAuth consent screen.
 *
 * @remarks
 * The consent screen shows which account a client is requesting access as, but had no way to
 * change it short of abandoning the request and starting over. This covers what the control
 * itself is responsible for: a deliberate sign-out that preserves the pending authorization
 * request as `?callbackURL=`, so choosing a different account resumes it rather than losing it.
 *
 * Deliberately stops at the sign-in redirect rather than completing a second passkey ceremony and
 * the full grant. A signup ceremony already runs earlier in this test (via `signUpAndOnboard`);
 * chaining a second real WebAuthn ceremony onto the same virtual authenticator in one test proved
 * flaky here (~2 of 3 runs) independent of anything this control does — `mcp-connect-cold-start.
 * spec.ts` covers a full sign-out → sign-in → resume → grant round trip already, with only one
 * ceremony in that test, and stays reliable. That's the shared resume machinery's contract;
 * this file's job is the button, not a second proof that Better Auth's own ceremony works.
 */
import { startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';

import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { discover, MCP_URL, REDIRECT_URI, registerClient } from '../helpers/mcp';

test('"Not you? Switch account" signs out and preserves the pending authorization request', async ({
  page,
}) => {
  // Onboarded, not just signed up: the realistic case for this control is an existing person
  // switching to the account they meant to use, not someone mid-signup.
  const { user } = await signUpAndOnboard(page, 'McpSwitchAccount');

  const discovery = await discover();
  const clientId = await registerClient(discovery, 'Docket E2E Switch-Account Client');
  const { authorizationUrl } = await startAuthorization(discovery.authorizationServerUrl, {
    metadata: discovery.metadata,
    clientInformation: { client_id: clientId },
    redirectUrl: REDIRECT_URI,
    scope: 'work:read',
    resource: new URL(MCP_URL),
  });

  // Already signed in, so this lands directly on consent — no sign-in hop yet.
  await page.goto(authorizationUrl.pathname + authorizationUrl.search);
  const allowAccess = page.getByRole('button', { name: 'Allow access' });
  await expect(allowAccess).toBeVisible({ timeout: TIMEOUTS.ceremony });
  await expect(page.getByText(user.email)).toBeVisible();

  await page.getByRole('button', { name: 'Not you? Switch account' }).click();

  // Signed out and bounced to sign-in with THIS exact request preserved via `?callbackURL=`,
  // not the raw-query shape the server's own forced sign-out uses (see `mcp-connect-cold-start.
  // spec.ts`) — both paths must resume, but this is the one this control is responsible for.
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible({
    timeout: TIMEOUTS.ceremony,
  });
  const signInUrl = new URL(page.url());
  expect(signInUrl.pathname).toBe('/sign-in');
  const callbackURL = signInUrl.searchParams.get('callbackURL');
  expect(callbackURL, 'the original authorization request must survive as callbackURL').toContain(
    `client_id=${clientId}`,
  );
});
