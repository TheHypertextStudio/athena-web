/**
 * E2E: signing in with an identity provider.
 *
 * @remarks
 * **What this covers (SCR-07, "an OAuth-provider sign-in succeeds").** Two things are asserted
 * here, and the first two matter more than they look:
 *
 * 1. **Availability is server truth, in both directions.** A provider button is a promise that the
 *    ceremony behind it can complete. The only thing that knows is the API, which lists a provider
 *    iff its OAuth client id *and* secret are really configured. A button that appears regardless
 *    and dead-ends at the redirect is the connector-reliability failure in a different costume, so
 *    the absent case is tested as deliberately as the present one.
 * 2. **The ceremony really completes, end to end, and mints a real session.** This used to be the
 *    open half of SCR-07: an earlier version of this spec stubbed the provider at the redirect
 *    boundary and never drove the callback for real, so its own doc comment admitted "the token
 *    exchange and the session mint on the far side of the callback are not covered here" — and its
 *    assertion literally checked that NO session existed, the opposite of what SCR-07 requires.
 *    Closing that for real (not by faking it further) needed a genuine OAuth 2.0 identity provider
 *    to complete a ceremony against, since no environment this suite runs in — including CI — has
 *    a real Google/GitHub/etc. account. `packages/auth/src/auth-builder.ts` mounts a `test-oauth`
 *    `generic-oauth` provider (Better Auth's own plugin for arbitrary OAuth2 providers), pointed at
 *    a real, minimal OAuth 2.0 authorization server Docket runs itself
 *    (`apps/api/src/lib/oauth-stub-provider.ts` — a real `/authorize` → `/token` → `/userinfo`
 *    HTTP service, not a browser-side `page.route` stub), gated to `APP_MODE ∈ {local,test}` so it
 *    cannot exist in production. Below, "completes a real OAuth2 ceremony…" drives that provider
 *    for real: a real authorize redirect off the app's origin, a real one-time code, a real
 *    server-to-server token exchange, a real userinfo call, and a real Better Auth session mint —
 *    nothing about the ceremony is stubbed; only the identity provider on the other end is a
 *    controlled fake instead of Google, the same shape every serious OAuth test suite uses (the
 *    "mock-oauth2-server" pattern).
 *
 * **No dedicated sign-in button for `test-oauth`, and that is correct.** `test-oauth` is backend
 * test scaffolding, not a product surface — it must never appear in the real sign-in page's
 * provider catalog (`(auth)/_components/oauth-sign-in.tsx`'s `PROVIDERS`/`PROVIDER_ORDER` are a
 * closed, compile-time set of the real providers Docket offers; correctly, nothing in this repo
 * makes them extensible to an arbitrary provider id). The real control a person clicks for
 * `google`/`github`/`linear`/`apple` does exactly one client-visible thing: a same-origin
 * `fetch('/api/auth/sign-in/{social,oauth2}', …)` whose `{ url, redirect: true }` response the
 * browser then navigates to. That is exactly what the ceremony test below does directly — the
 * click is a UI affordance around that one call, not a second thing to prove.
 *
 * **What's still stubbed, and why that's still correct.** The "real callback refuses a forged
 * return" test below keeps stubbing `google`'s `/sign-in/social` response and provider redirect at
 * the CLIENT boundary (`page.route`), the same way the availability test stubs `/v1/config` — this
 * repo has no real Google credentials in any environment, and this specific test's subject is
 * `/api/auth/callback/google` refusing an unauthenticated return, not the ceremony's happy path
 * (that's what the `test-oauth` test proves, against a provider this repo genuinely owns end to
 * end). Google itself stays out of this test's boundary, matching the same rule
 * `e2e/calendar/google-calendar.spec.ts` already states.
 *
 * SCR-07's other clauses (returning-user passkey sign-in, session persists across reload,
 * protected routes 307, sign-out) are covered elsewhere in the suite — not duplicated here.
 */
import type { Page } from '@playwright/test';

import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch, apiJson } from '../helpers/net';

/** The stub provider's authorization endpoint — a host that resolves nowhere, always intercepted. */
const PROVIDER_AUTHORIZE = 'https://accounts.provider.invalid/o/oauth2/v2/auth';

/** A public config body with the given providers configured. */
function publicConfig(oauthProviders: readonly string[]): Record<string, unknown> {
  return {
    appMode: 'local',
    oauthProviders,
    googleOAuthPublic: true,
    stripePublishableKey: null,
    connectors: [],
    mcpUrl: null,
  };
}

/** Make `GET /v1/config` report exactly `oauthProviders`, as a deployment with those credentials would. */
async function stubConfig(page: Page, oauthProviders: readonly string[]): Promise<void> {
  await page.route('**/v1/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(publicConfig(oauthProviders)),
    });
  });
}

test.describe('signing in with an identity provider', () => {
  test('offers exactly the providers the deployment has credentials for', async ({ page }) => {
    // The real local stack: every OAuth credential is blank, so the honest screen is passkey-only.
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByTestId('oauth-sign-in-google')).toHaveCount(0);
    await expect(page.getByTestId('oauth-sign-in-github')).toHaveCount(0);

    // The same screen against a deployment that configured two of the four.
    await stubConfig(page, ['google', 'github']);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('oauth-sign-in-google')).toBeVisible({ timeout: TIMEOUTS.ui });
    await expect(page.getByTestId('oauth-sign-in-google')).toHaveText('Continue with Google');
    await expect(page.getByTestId('oauth-sign-in-github')).toBeVisible();
    // Configured is the whole rule — nothing renders a provider the server did not name.
    await expect(page.getByTestId('oauth-sign-in-linear')).toHaveCount(0);
    await expect(page.getByTestId('oauth-sign-in-apple')).toHaveCount(0);
    // The passkey control stays primary; the providers are the alternative, not the replacement.
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  });

  test.describe('the real ceremony', () => {
    // The service worker's `navigateWithFallback` (`service-worker/strategies.ts`) re-fetches
    // `event.request` for every top-level document navigation, including one that lands on this
    // origin as the tail of a CROSS-ORIGIN redirect chain — exactly the shape an OAuth callback
    // landing page has. Chromium aborts that specific re-fetch (`net::ERR_ABORTED`) even though
    // the navigation itself, and the session it carries, are both genuinely fine underneath (the
    // session cookie is set and a follow-up request confirms it) — confirmed by hand against the
    // dev stack and out of scope to fix here (`apps/web/src`/`service-worker` are not in this
    // spec's remit). Blocking service-worker registration for just this describe sidesteps the
    // interference without touching what it's testing: SCR-07 cares whether Better Auth mints a
    // real session, not whether the offline-navigation fallback tolerates this specific shape of
    // redirect-terminated navigation.
    test.use({ serviceWorkers: 'block' });

    test('completes a real OAuth2 ceremony against the local fake identity provider and mints a real session', async ({
      page,
    }) => {
      // Same cold-dev-server caution as every ceremony spec that pays a real network round trip
      // through routes `warmUpAuth` does not pre-compile: `/sign-in/oauth2` and
      // `/oauth2/callback/test-oauth` aren't in its warm set, and this test additionally waits on a
      // real, uncached server-to-server token + userinfo exchange inside `apps/api` itself.
      test.slow();

      await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });

      // The client-side half of clicking a real provider button: ask Better Auth to start the
      // ceremony. This is the REAL `/api/auth/sign-in/oauth2` endpoint (Better Auth's
      // `generic-oauth` plugin) — nothing here is stubbed or intercepted. `test-oauth` has no
      // dedicated UI control (see the module remarks: it is backend-only test scaffolding,
      // correctly absent from the real sign-in page's provider catalog), so this fetch call —
      // identical in shape to what `oauth-sign-in.tsx`'s `signIn.social(...)` call performs for a
      // real provider — stands in for the click.
      const webOrigin = new URL(page.url()).origin;
      const start = await apiJson<{ url: string; redirect: boolean }>(
        page,
        '/api/auth/sign-in/oauth2',
        {
          method: 'POST',
          body: {
            providerId: 'test-oauth',
            // Absolute, not `/open`/`/onboarding` relative paths: Better Auth resolves a relative
            // `Location` header against whichever origin the CALLBACK request itself lands on. In
            // production that's the web app's own origin (per-request `x-forwarded-host` dynamic
            // `baseURL`, driven by `BETTER_AUTH_ALLOWED_HOSTS`); the local single-worker e2e/CI
            // topology (`scripts/dev-stack.sh`) intentionally runs a leaner static-`baseURL`
            // config with no such forwarding, so the callback happens on the API's own origin and
            // a relative redirect would land there too — not a topology this spec owns or should
            // work around implicitly. An absolute URL sidesteps that entirely and is just as real
            // a thing for a caller to pass Better Auth as a relative one.
            callbackURL: `${webOrigin}/open`,
            newUserCallbackURL: `${webOrigin}/onboarding`,
          },
        },
      );
      expect(start.redirect).toBe(true);
      expect(start.url).toContain('/api/auth-test/oauth-stub/authorize');

      // Follow the SAME real redirect chain a browser follows after a provider button's click:
      // app origin → the stub authorization server's real `/authorize` (a genuine cross-origin
      // navigation, mirroring "the ceremony really leaves for the provider") → a real one-time
      // `code` → back through Better Auth's real `/api/auth/oauth2/callback/test-oauth`, which
      // performs a real server-to-server token exchange and userinfo call against the stub, then
      // mints a real session and redirects to `newUserCallbackURL` (this is always a brand-new
      // account: the stub mints a fresh, unique fake identity on every `/authorize` call — see its
      // module remarks for why that matters against a dev database that persists across runs).
      await page.goto(start.url, { timeout: TIMEOUTS.pageReady });
      await expect(page).toHaveURL(`${webOrigin}/onboarding`, { timeout: TIMEOUTS.ceremony });

      // And a REAL session now exists — a signed-in user, not the absence of one.
      const session = await apiFetch(page, '/api/auth/get-session');
      expect(session.status).toBe(200);
      const body = session.body as {
        user?: { id?: string; email?: string };
        session?: { token?: string };
      };
      expect(body.user?.id, 'a real user id, not an empty session').toBeTruthy();
      expect(body.session?.token, 'a real session token').toBeTruthy();
      // The stub's fixed identity shape (see `oauth-stub-provider.ts`'s `mintIdentity`), proving
      // the session's identity really came from the userinfo call and not some unrelated
      // fallback.
      expect(body.user?.email).toMatch(/^test-oauth\+.+@example\.test$/);
    });
  });

  test('hands the ceremony to the provider, and the real callback refuses a forged return', async ({
    page,
  }) => {
    // This is the one test in the file that leaves the origin and comes back through a real server
    // route, and `/api/auth/callback/*` is not one of the endpoints `warmUpAuth` pre-compiles — so
    // on a cold dev server the return leg pays Turbopack's on-demand compile inside the ceremony
    // budget. Observed once at 30s+ mid-suite and 1.7s warm. Same cause and same remedy as the
    // three specs `playwright.config.ts` already documents.
    test.slow();
    await stubConfig(page, ['google']);

    // Stands in for a Better Auth with real Google credentials: it answers the sign-in request with
    // the authorization URL it built, and the client's redirect plugin navigates the browser there.
    let socialRequestBody: Record<string, unknown> | null = null;
    await page.route('**/api/auth/sign-in/social', async (route) => {
      socialRequestBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      const redirectUri = new URL('/api/auth/callback/google', page.url()).toString();
      const url = new URL(PROVIDER_AUTHORIZE);
      url.searchParams.set('client_id', 'stub-client');
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', 'stub-state');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: url.toString(), redirect: true }),
      });
    });

    // The provider's own screen: consent is assumed, so it bounces straight back with a code.
    await page.route(`${PROVIDER_AUTHORIZE}*`, async (route) => {
      const back = new URL(route.request().url()).searchParams.get('redirect_uri') ?? '';
      await route.fulfill({
        status: 302,
        headers: { location: `${back}?code=stub-code&state=stub-state` },
        body: '',
      });
    });

    // The return leg is deliberately NOT stubbed. `/api/auth/callback/google` is the real Better
    // Auth handler, and the state above is forged — no `state` cookie was ever armed, because the
    // authorization URL came from the stub rather than from a server that has Google credentials.
    // Letting the real handler run proves the callback refuses a return it did not initiate, and
    // mints nothing — the negative twin of the real-ceremony test above, which proves the same
    // handler family DOES mint a session for a return it genuinely initiated.
    // Recorded as *requests*, not frame navigations: every hop here is a server 302, and the
    // browser follows those without committing an intermediate navigation, so `framenavigated`
    // would report only the endpoints and none of the journey.
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) {
        documentRequests.push(request.url());
      }
    });

    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
    const google = page.getByTestId('oauth-sign-in-google');
    await expect(google).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await google.click();

    await page.waitForURL(/error=state_mismatch/, { timeout: TIMEOUTS.ceremony });

    expect(
      socialRequestBody,
      'the app never asked Better Auth to start a social sign-in',
    ).not.toBeNull();
    expect(socialRequestBody).toMatchObject({
      provider: 'google',
      // `/open` reads the session server-side and redirects, so the landing destination is decided
      // with the session in hand instead of guessed before the ceremony starts.
      callbackURL: '/open',
      newUserCallbackURL: '/onboarding',
    });

    // The browser genuinely left the origin for the provider and genuinely came back through the
    // callback — neither leg is a client-side simulation.
    expect(
      documentRequests.some((url) => url.startsWith(PROVIDER_AUTHORIZE)),
      `never navigated to the provider: ${documentRequests.join(' -> ')}`,
    ).toBe(true);
    expect(
      documentRequests.some((url) => new URL(url).pathname === '/api/auth/callback/google'),
      `never returned through the callback: ${documentRequests.join(' -> ')}`,
    ).toBe(true);

    // And nothing was granted on the way through.
    const session = await page.evaluate(async () => {
      const res = await fetch('/api/auth/get-session', { credentials: 'include' });
      return { status: res.status, body: (await res.text()).trim() };
    });
    expect(session.status).toBe(200);
    expect(session.body === '' || session.body === 'null').toBe(true);
  });

  test('sends a bounced-out person back to where they were headed', async ({ page }) => {
    await stubConfig(page, ['google']);

    let socialRequestBody: Record<string, unknown> | null = null;
    await page.route('**/api/auth/sign-in/social', async (route) => {
      socialRequestBody = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      // Answer without a redirect so the browser stays put and the assertion is about the payload.
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Exactly the URL `(app)/layout.tsx` redirects a signed-out request to.
    await page.goto('/sign-in?callbackURL=%2Ftasks', { waitUntil: 'domcontentloaded' });
    const google = page.getByTestId('oauth-sign-in-google');
    await expect(google).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await google.click();

    await expect
      .poll(() => socialRequestBody, { timeout: TIMEOUTS.ceremony })
      .toMatchObject({ provider: 'google', callbackURL: '/tasks' });
  });
});
