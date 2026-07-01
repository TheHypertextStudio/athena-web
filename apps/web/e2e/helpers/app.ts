/**
 * Shared app-flow helpers for the e2e specs — the common ceremonies (passkey-route warm-up,
 * sign-up, onboarding, sign-out, lost-device) so no spec re-implements them. All navigation is
 * relative to `baseURL`.
 */
import type { Page } from '@playwright/test';

import { TIMEOUTS } from './constants';
import { expect } from './fixtures';
import { apiFetch, waitForApiResponse, type ApiInit } from './net';
import { clearVirtualCredentials } from './webauthn';

/** A throwaway test account: display name + unique email. */
export interface TestUser {
  name: string;
  email: string;
}

/** A unique throwaway test user; the embedded pglite dev DB is disposable, so accounts are cheap. */
export function newUser(label: string): TestUser {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { name: `${label} E2E`, email: `${label.toLowerCase()}+${tag}@example.com` };
}

/** Sign out of the current session (drops the cookie). */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Simulate a lost passkey: wipe the device's credential, then sign out. */
export async function loseDevice(page: Page): Promise<void> {
  await clearVirtualCredentials(page);
  await signOut(page);
}

/** Hit a same-origin `path` until next-dev has compiled it (a real HTTP status, not an abort). */
async function pollCompiled(page: Page, path: string, init: ApiInit = {}): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await apiFetch(page, path, init); // any real response means the route compiled
      return;
    } catch {
      // Cold / mid-HMR route aborted — wait and retry.
    }
    await page.waitForTimeout(1000);
  }
}

/**
 * Pre-compile the lazily-built passkey routes so the real ceremonies don't hit a cold/HMR route.
 *
 * @remarks
 * `next dev` compiles each route on first request, and a cold (or mid-recompile) hit aborts/500s the
 * in-flight passkey ceremony — surfacing as a "temporarily unavailable" alert. Polling each endpoint
 * until it returns a real status proves the route is compiled. Call on a page already on the app
 * origin.
 */
async function warmUpAuth(page: Page): Promise<void> {
  const post: ApiInit = { method: 'POST', body: {} };
  // The independent passkey routes compile in parallel; minting a signed intent context (which warms
  // its own route) runs alongside them.
  const [context] = await Promise.all([
    apiFetch(page, '/passkey-intent', {
      method: 'POST',
      body: { name: 'warm', email: `warm-${Date.now()}@example.com` },
    })
      .then((r) => (r.body as { context?: string } | null)?.context ?? 'bogus')
      .catch(() => 'bogus'),
    pollCompiled(page, '/api/auth/passkey/generate-authenticate-options'),
    pollCompiled(page, '/api/auth/passkey/verify-authentication', post),
    pollCompiled(page, '/api/auth/passkey/verify-registration', post),
  ]);
  // generate-register-options needs the signed context, so warm it once that's minted.
  const params = new URLSearchParams({ name: 'warm', context });
  await pollCompiled(page, `/api/auth/passkey/generate-register-options?${params.toString()}`);
}

/**
 * Sign up via the real passkey sign-up ceremony; resolves once onboarding is reached.
 *
 * @remarks
 * Warms the passkey routes first, then runs the ceremony — retrying the whole thing (same throwaway
 * email; a failed ceremony creates no user) past a transient cold-route "temporarily unavailable".
 * The sign-up form is controlled, so it re-fills until React has hydrated and the submit enables.
 */
export async function signUp(page: Page, { name, email }: TestUser): Promise<void> {
  await page.goto('/sign-up', { waitUntil: 'networkidle' });
  await warmUpAuth(page);

  const createBtn = page.getByRole('button', { name: 'Create account' });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await page.goto('/sign-up', { waitUntil: 'networkidle' });
    await expect(async () => {
      await page.fill('#name', name);
      await page.fill('#email', email);
      expect(await createBtn.isEnabled()).toBe(true);
    }).toPass({ timeout: TIMEOUTS.ui });
    await createBtn.click();

    const reached = await Promise.race([
      page.waitForURL('**/onboarding**', { timeout: TIMEOUTS.ceremony }).then(() => true),
      page
        .locator('[role="alert"]')
        .filter({ hasText: /\S/ })
        .first()
        .waitFor({ timeout: TIMEOUTS.ceremony })
        .then(() => false)
        .catch(() => null),
    ]);
    if (reached === true) return;
    await page.waitForTimeout(1500); // let the dev route settle, then retry
  }
  throw new Error('sign-up never reached onboarding after retries');
}

/** Take the "Just me" onboarding fork; returns the personal org id it mints (from POST /v1/orgs). */
async function onboardJustMe(page: Page): Promise<string> {
  const orgIdFromResponse = waitForApiResponse(page, /\/v1\/orgs(\?|$)/, { method: 'POST' }).then(
    async (r) => ((await r.json()) as { organization?: { id?: string } }).organization?.id,
  );

  await page.getByText('Just me', { exact: false }).first().click();
  await page.getByRole('button', { name: /Create your space|Continue/ }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click({ timeout: TIMEOUTS.sweep });

  const orgId = await orgIdFromResponse;
  expect(orgId, 'onboarding did not return a personal org id').toBeTruthy();
  return orgId!;
}

/** Sign up a fresh user and onboard the "Just me" personal workspace; returns `{ user, orgId }`. */
export async function signUpAndOnboard(
  page: Page,
  label: string,
): Promise<{ user: TestUser; orgId: string }> {
  const user = newUser(label);
  await signUp(page, user);
  const orgId = await onboardJustMe(page);
  return { user, orgId };
}
