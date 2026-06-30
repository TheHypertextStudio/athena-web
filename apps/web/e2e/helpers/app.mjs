/**
 * Shared app-flow helpers for the e2e specs — the common ceremonies (passkey-route warm-up,
 * sign-up, onboarding), so no spec re-implements them. All navigation is relative to `baseURL`.
 */
import { expect } from '@playwright/test';

/** A unique throwaway test user; the embedded pglite dev DB is disposable, so accounts are cheap. */
export function newUser(label) {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { name: `${label} E2E`, email: `${label.toLowerCase()}+${tag}@example.com` };
}

/** Hit a same-origin `path` until next-dev has compiled it (a real HTTP status, not an abort). */
async function pollCompiled(page, path, init) {
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(
      async ({ p, opts }) => {
        try {
          return typeof (await fetch(p, opts)).status === 'number';
        } catch {
          return false;
        }
      },
      { p: path, opts: init },
    );
    if (ready) return;
    await page.waitForTimeout(1000);
  }
}

/**
 * Pre-compile the lazily-built passkey routes so the real ceremonies don't hit a cold/HMR route.
 *
 * @remarks
 * `next dev` compiles each route on first request, and a cold (or mid-recompile) hit aborts/500s
 * the in-flight passkey ceremony — surfacing as a "temporarily unavailable" alert. Polling each
 * endpoint until it returns a real status proves the route is compiled. Call on a page already on
 * the app origin.
 */
async function warmUpAuth(page) {
  const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
  // The independent passkey routes compile in parallel; minting a signed intent context (which warms
  // its own route) runs alongside them.
  const [context] = await Promise.all([
    page.evaluate(async () => {
      try {
        const r = await fetch('/passkey-intent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'warm', email: `warm-${Date.now()}@example.com` }),
        });
        return (await r.json()).context;
      } catch {
        return 'bogus';
      }
    }),
    pollCompiled(page, '/api/auth/passkey/generate-authenticate-options'),
    pollCompiled(page, '/api/auth/passkey/verify-authentication', post),
    pollCompiled(page, '/api/auth/passkey/verify-registration', post),
  ]);
  // generate-register-options needs the signed context, so warm it once that's minted.
  const params = new URLSearchParams({ name: 'warm', context: context ?? 'bogus' });
  await pollCompiled(page, `/api/auth/passkey/generate-register-options?${params}`);
}

/**
 * Sign up via the real passkey sign-up ceremony; resolves once onboarding is reached.
 *
 * @remarks
 * Warms the passkey routes first, then runs the ceremony — retrying the whole thing (same throwaway
 * email; a failed ceremony creates no user) past a transient cold-route "temporarily unavailable".
 * The sign-up form is controlled, so it re-fills until React has hydrated and the submit enables.
 */
export async function signUp(page, { name, email }) {
  await page.goto('/sign-up', { waitUntil: 'networkidle' });
  await warmUpAuth(page);

  const createBtn = page.getByRole('button', { name: 'Create account' });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.goto('/sign-up', { waitUntil: 'networkidle' });
    await expect(async () => {
      await page.fill('#name', name);
      await page.fill('#email', email);
      expect(await createBtn.isEnabled()).toBe(true);
    }).toPass({ timeout: 15_000 });
    await createBtn.click();

    const reached = await Promise.race([
      page.waitForURL('**/onboarding**', { timeout: 30_000 }).then(() => true),
      page
        .locator('[role="alert"]')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ timeout: 30_000 })
        .then(() => false)
        .catch(() => null),
    ]);
    if (reached === true) return;
    await page.waitForTimeout(1500); // let the dev route settle, then retry
  }
  throw new Error('sign-up never reached onboarding after retries');
}

/** Take the "Just me" onboarding fork; returns the personal org id it mints (from POST /v1/orgs). */
async function onboardJustMe(page) {
  const orgIdFromResponse = page
    .waitForResponse(
      (r) => r.request().method() === 'POST' && /\/v1\/orgs(\?|$)/.test(r.url()) && r.ok(),
    )
    .then(async (r) => (await r.json())?.organization?.id);

  await page.getByText('Just me', { exact: false }).first().click();
  await page.getByRole('button', { name: /Create your space|Continue/ }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click({ timeout: 45_000 });

  const orgId = await orgIdFromResponse;
  expect(orgId, 'onboarding did not return a personal org id').toBeTruthy();
  return orgId;
}

/** Sign up a fresh user and onboard the "Just me" personal workspace; returns `{ user, orgId }`. */
export async function signUpAndOnboard(page, label) {
  const user = newUser(label);
  await signUp(page, user);
  const orgId = await onboardJustMe(page);
  return { user, orgId };
}
