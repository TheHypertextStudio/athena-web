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
import { newUser, signOut, signUp } from './helpers/app';
import { TIMEOUTS } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { discover, exchangeCode, newPkce, REDIRECT_URI, registerClient } from './helpers/mcp';

test('an unauthenticated MCP authorize request resumes to consent after sign-in, not /today', async ({
  page,
  request,
}) => {
  // A returning user: has an account and a passkey, but no session on this browser right now.
  await signUp(page, newUser('McpColdStart'));
  await signOut(page);

  const discovery = await discover(request);
  const clientId = await registerClient(request, discovery, 'Docket E2E Cold-Start Client');
  const pkce = newPkce();
  const authorizePath = new URL(discovery.authorizationEndpoint).pathname;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'work:read',
    state: 'cold-start-state',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
  });

  await page.goto(`${authorizePath}?${params.toString()}`);

  // No session -> Better Auth's oauthProvider plugin bounces to sign-in with the raw OAuth query intact.
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible({
    timeout: TIMEOUTS.ceremony,
  });
  expect(page.url()).toContain('response_type=code');
  expect(page.url()).toContain(`client_id=${clientId}`);

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();

  // Must land back on the consent screen for THIS client - never /today, and never left on
  // sign-in with the request abandoned.
  await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible({
    timeout: TIMEOUTS.ceremony,
  });
  await page.getByRole('button', { name: 'Authorize' }).click();

  await page.waitForURL(`${REDIRECT_URI}*`, { timeout: TIMEOUTS.ceremony });
  const redirected = new URL(page.url());
  expect(redirected.searchParams.get('error')).toBeNull();
  const code = redirected.searchParams.get('code');
  expect(code, 'authorize redirect must carry a code').toBeTruthy();
  if (!code) throw new Error('authorize redirect must carry a code');

  // The code is real and exchanges cleanly - the whole chain, not just the UI hop.
  const { accessToken } = await exchangeCode(request, discovery, { clientId, code, pkce });
  expect(accessToken).toBeTruthy();
});
