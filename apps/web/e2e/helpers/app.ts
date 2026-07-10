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

/** Sign out of the current session server-side, then clear any residual browser cookies. */
export async function signOut(page: Page): Promise<void> {
  const result = await apiFetch(page, '/api/auth/sign-out', { method: 'POST', body: {} });
  expect(result.status, 'Better Auth sign-out should succeed').toBe(200);
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
  // The independent passkey + sign-up-challenge routes compile in parallel.
  await Promise.all([
    apiFetch(page, '/api/auth/sign-up/request-code', {
      method: 'POST',
      body: { name: 'warm', email: `warm-${Date.now()}@example.com` },
    }).catch(() => null),
    pollCompiled(page, '/api/auth/sign-up/verify-code', post),
    pollCompiled(page, '/api/auth/passkey/generate-authenticate-options'),
    pollCompiled(page, '/api/auth/passkey/verify-authentication', post),
    pollCompiled(page, '/api/auth/passkey/verify-registration', post),
    pollCompiled(page, '/api/auth/passkey/generate-register-options', post),
  ]);
}

/**
 * Sign up via the real passkey sign-up ceremony; resolves once onboarding is reached.
 *
 * @remarks
 * Two-step verify-before-passkey flow: (1) enter name + email and request a one-time code; the dev
 * stack echoes the code in the `/sign-up/request-code` response (`APP_MODE=local`), which we read
 * off the intercepted response, (2) enter the code and run the passkey ceremony. Warms the routes
 * first and retries in place past a transient cold-route error. A failed attempt may have already
 * created the account, so on retry the "Use a different email" reset returns to a clean step 1.
 */
export async function signUp(page: Page, { name, email }: TestUser): Promise<void> {
  await page.goto('/sign-up', { waitUntil: 'domcontentloaded' });
  await warmUpAuth(page);

  const continueButton = page.getByRole('button', { name: 'Continue with email' });
  const verifyButton = page.getByRole('button', { name: 'Verify and create account' });

  for (let attempt = 0; attempt < 4; attempt++) {
    // Step 1: name + email → request a code, capturing the dev-echoed code from the response.
    await expect(async () => {
      await page.fill('#name', name);
      await page.fill('#email', email);
      expect(await continueButton.isEnabled()).toBe(true);
    }).toPass({ timeout: TIMEOUTS.ui });

    const codeResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/sign-up/request-code') && r.request().method() === 'POST',
      { timeout: TIMEOUTS.ceremony },
    );
    await continueButton.click();
    const devCode = await codeResponse
      .then((r) => r.json())
      .then((b: { devCode?: string }) => b.devCode)
      .catch(() => undefined);

    // Step 2: enter the code and complete the passkey ceremony.
    if (devCode) {
      await page.fill('#code', devCode);
      await verifyButton.click();
    }

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
    // Reset to a clean step 1 before retrying (a prior attempt may have consumed the code).
    await page
      .getByRole('button', { name: 'Use a different email' })
      .click()
      .catch(() => undefined);
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
