/**
 * The standardized e2e base test.
 *
 * @remarks
 * Every spec imports `{ test, expect }` from here instead of `@playwright/test` directly, so each
 * test's `page` arrives with a CDP WebAuthn *virtual authenticator* already installed — the
 * passwordless passkey ceremonies (sign-up, sign-in, the step-up re-auth) then complete headlessly
 * without real hardware. Origin, HTTPS-trust, headless, and trace/screenshot policy come from
 * `playwright.config.ts`, never per-spec.
 */
import { expect, test as base } from '@playwright/test';

import { addVirtualAuthenticator } from './webauthn';

/** Base test with a passkey-capable `page` (virtual authenticator auto-installed per test). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await addVirtualAuthenticator(page);
    await use(page);
  },
});

export { expect };
