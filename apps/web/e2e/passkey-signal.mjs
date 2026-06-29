/**
 * End-to-end test: sign-in prunes a server-deleted passkey via the WebAuthn Signal API.
 *
 * Drives the real browser flow against a running dev server:
 *   1. register a passkey (sign-up) on a CDP virtual authenticator,
 *   2. delete it server-side via the session-protected delete endpoint,
 *   3. sign out and attempt passkey sign-in,
 * then asserts the server rejects with 401 PASSKEY_NOT_FOUND AND the app calls
 * `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })` with the exact
 * credential that was just deleted — i.e. the browser is told to drop the stale passkey.
 *
 * Self-asserting: throws on any failure (screenshots + exit 1), prints OK + exit 0 on success.
 *
 * Prerequisite: a running dev server (`pnpm dev`) at APP_URL (default https://docket.localhost).
 * The credential lives only in the virtual authenticator, so registration and sign-in must run
 * in the SAME browser context.
 *
 * Usage: node apps/web/e2e/passkey-signal.mjs [outDir]
 */
import { chromium } from '@playwright/test';

import { addVirtualAuthenticator, installSignalSpy } from './_lib/webauthn.mjs';

const BASE = process.env.APP_URL ?? 'https://docket.localhost';
const EXPECTED_RP_ID = process.env.PASSKEY_RP_ID ?? 'docket.localhost';
const OUT = process.argv[2] ?? '.';
const stamp = Date.now();

/** Better Auth passkey endpoints, same-origin (Next-proxied to the API). */
const LIST_URL = `${BASE}/api/auth/passkey/list-user-passkeys`;
const DELETE_URL = `${BASE}/api/auth/passkey/delete-passkey`;

/** Fetch the signed-in user's passkeys from the page (carries the session cookie). */
async function listPasskeys(page) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`list-user-passkeys ${res.status}`);
    return res.json();
  }, LIST_URL);
}

/**
 * Pre-compile the passkey routes so the real ceremonies don't hit a cold/recompiling dev route.
 *
 * @remarks
 * `next dev` compiles each route lazily on first request, and a recent source edit triggers an
 * HMR recompile that aborts/500s in-flight requests — either of which would make the
 * registration/sign-in ceremonies flaky. This polls each endpoint (with throwaway params) until
 * it returns a real HTTP status rather than an aborted/compiling request, proving the route is
 * compiled and the server has settled. Must run on a page already on the app origin so the
 * same-origin fetches resolve.
 */
async function warmUpPasskeyRoutes(page) {
  const endpoints = [
    { url: '/api/auth/passkey/generate-authenticate-options', init: undefined },
    {
      url: '/api/auth/passkey/verify-authentication',
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    },
    {
      url: '/api/auth/passkey/verify-registration',
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    },
  ];
  // generate-register-options needs a valid signed context; mint one (its own route is warmed too).
  const intentUrl = `${BASE}/passkey-intent`;
  for (const { url, init } of endpoints) {
    await pollCompiled(page, `${BASE}${url}`, init);
  }
  const context = await page.evaluate(async (u) => {
    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'warm', email: `warm-${Date.now()}@example.com` }),
      });
      return (await r.json()).context;
    } catch {
      return 'bogus';
    }
  }, intentUrl);
  const registerOptions = `${BASE}/api/auth/passkey/generate-register-options?${new URLSearchParams(
    { name: 'warm', context: context ?? 'bogus' },
  )}`;
  await pollCompiled(page, registerOptions, undefined);
}

/** Hit `url` until it returns a real HTTP status (not an aborted/compiling request). */
async function pollCompiled(page, url, init) {
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(
      async ({ u, opts }) => {
        try {
          const r = await fetch(u, opts);
          return typeof r.status === 'number'; // any HTTP status ⇒ route compiled & served
        } catch {
          return false; // network abort ⇒ still compiling / recompiling
        }
      },
      { u: url, opts: init },
    );
    if (ok) return;
    await page.waitForTimeout(1000);
  }
}

let page = null;
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  page.on('requestfailed', (r) =>
    console.log(`  [reqfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`),
  );

  await addVirtualAuthenticator(page);

  // Pre-compile the passkey routes (next dev compiles lazily; a cold first hit is flaky).
  console.log('→ warming passkey routes');
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await warmUpPasskeyRoutes(page);

  // 1. Register a passkey via the real sign-up ceremony. Retry the whole ceremony with a fresh
  // email on a transient dev-server outage (aborted/cold route) — a new email is a new user, so
  // there is no duplicate-registration conflict on the virtual authenticator.
  console.log('→ sign-up (register passkey)');
  const createBtn = page.getByRole('button', { name: 'Create account' });
  let onboarded = false;
  for (let attempt = 0; attempt < 4 && !onboarded; attempt++) {
    await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
    // The form is controlled; filling before React hydrates gets clobbered. Re-fill until enabled.
    let enabled = false;
    for (let i = 0; i < 25 && !enabled; i++) {
      await page.fill('#name', 'Passkey Signal E2E');
      await page.fill('#email', `passkey-e2e+${stamp}-${attempt}@example.com`);
      await page.waitForTimeout(200);
      enabled = await createBtn.isEnabled();
    }
    if (!enabled) throw new Error('Create account never enabled (hydration/WebAuthn gate)');
    await createBtn.click();

    console.log('→ awaiting passkey ceremony → onboarding');
    const reached = await Promise.race([
      page.waitForURL('**/onboarding**', { timeout: 30_000 }).then(() => 'onboarding'),
      page
        .locator('[role="alert"]')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ timeout: 30_000 })
        .then(() => 'alert')
        .catch(() => null),
    ]);
    if (reached === 'onboarding') {
      onboarded = true;
      break;
    }
    const alertText = await page
      .locator('[role="alert"]')
      .allInnerTexts()
      .catch(() => []);
    console.log(`  sign-up attempt ${attempt + 1} did not reach onboarding; alerts=${JSON.stringify(alertText)} — retrying`);
    await page.waitForTimeout(2000);
  }
  if (!onboarded) throw new Error('sign-up never reached onboarding after retries');

  // 2. Capture the registered credential, then delete the passkey server-side.
  const before = await listPasskeys(page);
  if (!Array.isArray(before) || before.length === 0) {
    throw new Error(`expected a registered passkey, got ${JSON.stringify(before)}`);
  }
  const credentialId = before[0].credentialID;
  const passkeyRowId = before[0].id;
  if (!credentialId || !passkeyRowId) {
    throw new Error(`passkey row missing id/credentialID: ${JSON.stringify(before[0])}`);
  }
  console.log(`→ registered credentialID=${credentialId}`);

  console.log('→ deleting passkey server-side');
  const deleteStatus = await page.evaluate(
    async ({ url, id }) => {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      return res.status;
    },
    { url: DELETE_URL, id: passkeyRowId },
  );
  if (deleteStatus < 200 || deleteStatus >= 300) {
    throw new Error(`delete-passkey returned ${deleteStatus}`);
  }
  const after = await listPasskeys(page);
  if (Array.isArray(after) && after.length !== 0) {
    throw new Error(`passkey was not deleted server-side; still ${after.length} row(s)`);
  }
  console.log('→ passkey deleted (server no longer holds it)');

  // 3. Sign out, install the Signal spy, and attempt sign-in with the now-stale credential.
  await context.clearCookies();
  await installSignalSpy(page);

  console.log('→ sign-in with the deleted passkey');
  // Record the verify-authentication outcome from a persistent listener so we catch it whether
  // it comes from the explicit button click or the conditional-UI autofill armed on mount.
  let verifyStatus = null;
  page.on('response', (res) => {
    if (/\/passkey\/verify-authentication(\?|$)/.test(res.url())) verifyStatus = res.status();
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  const signInBtn = page.getByRole('button', { name: 'Sign in with a passkey' });
  // Retry the click past a transient dev-server outage (an aborted/cold ceremony posts no
  // verify-authentication); a re-click hits the now-warm route.
  for (let attempt = 0; attempt < 4 && verifyStatus === null; attempt++) {
    await signInBtn.click();
    for (let i = 0; i < 20 && verifyStatus === null; i++) await page.waitForTimeout(500);
  }
  if (verifyStatus === null) {
    throw new Error('verify-authentication never fired (sign-in ceremony did not run)');
  }

  // Assert: the server actually rejected the deleted credential.
  if (verifyStatus !== 401) {
    throw new Error(`expected verify-authentication 401, got ${verifyStatus}`);
  }
  console.log('✓ server returned 401 (PASSKEY_NOT_FOUND)');

  // Best-effort: the explicit button path surfaces an error alert, but the conditional-UI
  // autofill path is intentionally silent — and it auto-completes against the virtual
  // authenticator here. So log the alert if present without failing on its absence; the
  // user-facing copy itself is unit-tested in @docket/types.
  const alertText = await page
    .locator('[role="alert"]')
    .filter({ hasText: /\S/ })
    .first()
    .innerText({ timeout: 3_000 })
    .catch(() => null);
  console.log(alertText ? `✓ sign-in error surfaced: ${alertText}` : '· (autofill path: no alert, as designed)');

  // Assert: the app told the browser to prune the stale credential, with the right args.
  const signalCalls = await page.evaluate(() => window.__signalCalls ?? []);
  const match = signalCalls.find(
    (c) => c && c.rpId === EXPECTED_RP_ID && c.credentialId === credentialId,
  );
  if (!match) {
    throw new Error(
      `signalUnknownCredential was not called with { rpId: '${EXPECTED_RP_ID}', credentialId: '${credentialId}' }. ` +
        `Recorded calls: ${JSON.stringify(signalCalls)}`,
    );
  }
  console.log('✓ signalUnknownCredential called with the deleted credential');

  console.log('OK — sign-in prunes a server-deleted passkey via the Signal API');
  await browser.close();
}

main().catch(async (err) => {
  console.error('FAILED:', err?.message ?? err);
  if (page) {
    try {
      await page.screenshot({ path: `${OUT}/passkey-signal-FAILURE-${stamp}.png`, fullPage: true });
      console.error(`  failure screenshot: ${OUT}/passkey-signal-FAILURE-${stamp}.png`);
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 1;
});
