/**
 * Shared app-flow helpers for the e2e specs — the common ceremonies (passkey-route warm-up,
 * sign-up, onboarding, sign-out, lost-device) so no spec re-implements them. All navigation is
 * relative to `baseURL`.
 */
import type { Page } from '@playwright/test';
import { SESSION_OWNER_HEADER } from '@docket/identity-access/session-contract';

import { TIMEOUTS } from './constants';
import { expect } from './fixtures';
import { apiFetch, waitForApiResponse, type ApiInit } from './net';
import { clearVirtualCredentials } from './webauthn';
import { assertDefined } from '@docket/test-utils';

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
  const session = await apiFetch(page, '/api/auth/get-session');
  const userId =
    typeof session.body === 'object' &&
    session.body !== null &&
    'user' in session.body &&
    typeof session.body.user === 'object' &&
    session.body.user !== null &&
    'id' in session.body.user &&
    typeof session.body.user.id === 'string'
      ? session.body.user.id
      : null;
  if (userId === null) {
    await page.context().clearCookies();
    return;
  }
  const result = await apiFetch(page, '/api/auth/sign-out', {
    method: 'POST',
    body: {},
    headers: { [SESSION_OWNER_HEADER]: userId },
  });
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
  // `pageReady`, not Playwright's 30s default: this is the first request to `/sign-up` in a run,
  // so `next dev` compiles the route's client bundle before it can answer. A cold compile measured
  // ~40s here, which the default silently turns into "page.goto: Timeout 30000ms exceeded" — a
  // failure that reads like the app is down rather than like it is still building. Every other
  // wait in this helper already budgets for that; this one was the gap.
  await page.goto('/sign-up', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageReady });
  await warmUpAuth(page);

  const continueButton = page.getByRole('button', { name: 'Continue with email' });
  const verifyButton = page.getByRole('button', { name: 'Verify and create account' });

  for (let attempt = 0; attempt < 4; attempt++) {
    // Step 1: name + email → request a code, capturing the dev-echoed code from the response.
    // `pageReady`, not `ui`: `canSubmit` on this page gates on hydration, which `warmUpAuth`
    // above does not cover (it only pre-compiles the API routes) — a cold `/sign-up` bundle can
    // leave this button disabled well past `ui`'s budget, and unlike the ceremony-failure retry
    // below, a timeout here throws immediately rather than looping to a fresh attempt.
    // Clicked, then typed. `fill` sets the value and dispatches one synthetic `input`, and against
    // these controlled fields the value reads back empty a moment later — the form re-renders from
    // state that never saw the change, so `canSubmit` stays false and this block times out with no
    // symptom beyond a disabled button. Typing sends the per-keystroke events the field reacts to,
    // but only once it holds focus, so the click is load-bearing rather than decoration.
    //
    // `fill('')` first so a retry does not append to a half-filled field.
    await expect(async () => {
      for (const [selector, value] of [
        ['#name', name],
        ['#email', email],
      ] as const) {
        const field = page.locator(selector);
        await field.click();
        await field.fill('');
        await field.pressSequentially(value);
      }
      expect(await continueButton.isEnabled()).toBe(true);
    }).toPass({ timeout: TIMEOUTS.pageReady });

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
  // The personal fork creates its workspace as soon as the intent card is selected. Waiting for
  // the connection step keeps this helper aligned with that transition and avoids targeting its
  // disabled primary action while the organization request is still in flight.
  await page.getByRole('button', { name: 'Skip for now' }).waitFor({
    state: 'visible',
    timeout: TIMEOUTS.sweep,
  });
  await page.getByRole('button', { name: 'Skip for now' }).click({ timeout: TIMEOUTS.sweep });

  const orgId = await orgIdFromResponse;
  expect(orgId, 'onboarding did not return a personal org id').toBeTruthy();
  return assertDefined(orgId);
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
