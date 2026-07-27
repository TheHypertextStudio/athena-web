/**
 * MCP e2e — cold-start authorize: no session on the browser at all when the MCP client's
 * authorize request lands.
 *
 * @remarks
 * Regression coverage for a real production incident: Better Auth's `oauthProvider` plugin
 * redirects an unauthenticated visitor from its `/oauth2/authorize` endpoint straight to
 * `/sign-in`, appending the original OAuth request's raw query string (not `?callbackURL=`).
 * Docket's sign-in ceremony
 * completes via `fetch()`, not a top-level navigation, so Better Auth's own server-side auto-resume
 * (a signed cookie + a global `hooks.after` middleware) never fires — nothing else in this suite
 * exercised that path, since `mcp-connect.spec.ts`'s interactive leg always runs in an
 * already-signed-in browser. Left unfixed, a returning user connecting a new MCP client landed on
 * `/today` with the authorization request silently abandoned instead of the consent screen.
 */
import { startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';

import { newUser, signOut, signUp } from './helpers/app';
import { TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { discover, exchangeCode, MCP_URL, REDIRECT_URI, registerClient } from './helpers/mcp';

test('an unauthenticated MCP authorize request resumes to consent after sign-in, not /today', async ({
  page,
}) => {
  // A returning user: has an account and a passkey, but no session on this browser right now.
  await signUp(page, newUser('McpColdStart'));
  await signOut(page);

  const discovery = await discover();
  const clientId = await registerClient(discovery, 'Docket E2E Cold-Start Client');
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

  await page.goto(authorizationUrl.pathname + authorizationUrl.search);

  // No session -> Better Auth's oauthProvider plugin bounces to sign-in with the raw OAuth query intact.
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible({
    timeout: TIMEOUTS.ceremony,
  });
  expect(page.url()).toContain('response_type=code');
  expect(page.url()).toContain(`client_id=${clientId}`);

  // The sign-in page arms WebAuthn conditional mediation (`autoFill: true`) on mount, and the
  // virtual authenticator satisfies it on its own — so the ceremony often completes with no click
  // at all and the app navigates to consent while Playwright is still running its actionability
  // checks on this button. The click then hangs against a detached element even though the flow
  // succeeded. Both orderings are a correct resume, so race the click against the outcome; the
  // assertion below is what actually gates the test.
  const authorize = page.getByRole('button', { name: 'Authorize' });
  await Promise.race([
    page
      .getByRole('button', { name: 'Sign in with a passkey' })
      .click({ timeout: TIMEOUTS.ceremony })
      .catch(() => undefined),
    authorize.waitFor({ state: 'visible', timeout: TIMEOUTS.ceremony }),
  ]);

  // Must land back on the consent screen for THIS client - never /today, and never left on
  // sign-in with the request abandoned.
  await expect(authorize).toBeVisible({ timeout: TIMEOUTS.ceremony });
  await authorize.click();

  await page.waitForURL(`${REDIRECT_URI}*`, { timeout: TIMEOUTS.ceremony });
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get('error')).toBeNull();
  const code = redirected.searchParams.get('code');
  expect(code, 'authorize redirect must carry a code').toBeTruthy();
  if (!code) throw new Error('authorize redirect must carry a code');

  // The code is real and exchanges cleanly - the whole chain, not just the UI hop.
  const { accessToken } = await exchangeCode(discovery, { clientId, code, codeVerifier });
  expect(accessToken).toBeTruthy();
});
