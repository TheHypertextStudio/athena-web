/**
 * `pnpm --filter @docket/web exec tsx e2e/tools/dev-session.ts` — sign up (or re-sign-up) a
 * throwaway dev account against the running dev stack and persist the authenticated browser
 * storage state to disk.
 *
 * @remarks
 * Manual/visual auditing (design-review passes, ad-hoc poking at a page) needs a real
 * authenticated session, but this app gates everything behind a passwordless passkey ceremony
 * ({@link https://../../../auth/src/auth-builder.ts Better Auth passkey config}) — there is no
 * password to type around it. Re-running the full sign-up → verify-code → passkey ceremony by
 * hand (or worse, in a throwaway one-off script) every time is slow and, per repo convention,
 * not how reusable dev tooling is supposed to work here.
 *
 * This script reuses the e2e suite's own, already-proven ceremony helpers —
 * {@link file://../helpers/webauthn.ts} for the CDP virtual authenticator and
 * {@link file://../helpers/app.ts}'s `signUpAndOnboard` for the sign-up + "Just me" onboarding
 * flow — instead of re-implementing selectors. Only the *driving* (a standalone browser launch,
 * not a Playwright test) and the *persistence* (Playwright `storageState` + a small metadata
 * sidecar) are new. The resulting session is then reusable by
 * {@link file://./capture-shots.ts} or any other script/tool, so the ceremony runs once per
 * dev-stack lifetime rather than once per audit.
 *
 * Requires `APP_MODE=local` or `test` on the API (so `/sign-up/request-code` echoes the
 * verification code in-band — see `packages/auth/src/signup-challenge.ts`'s `devEchoCode`).
 * Points at `APP_URL`/`PASSKEY_RP_ID` exactly like the e2e suite ({@link ./../helpers/constants.ts}),
 * so it works against the normal portless origin (`https://docket.localhost`) or a bypass origin
 * (e.g. `APP_URL=http://localhost:4200 PASSKEY_RP_ID=localhost`) when portless isn't available.
 *
 * Usage (from `apps/web`):
 *   tsx e2e/tools/dev-session.ts [--label=<label>] [--out=<path>]
 *
 * Writes:
 *   <out>            — Playwright storageState JSON (cookies + origins)
 *   <out>.meta.json   — { email, orgId, baseURL } for downstream tools
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { signUpAndOnboard } from '../helpers/app';
import { ORIGIN } from '../helpers/constants';
import { addVirtualAuthenticator } from '../helpers/webauthn';

interface CliArgs {
  label: string;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) flags.set(key, value);
    }
  }
  return {
    label: flags.get('label') ?? 'dev-audit',
    out: resolve(flags.get('out') ?? 'playwright/.auth/dev-session.json'),
  };
}

async function main(): Promise<void> {
  const { label, out } = parseArgs(process.argv.slice(2));

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: ORIGIN, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await addVirtualAuthenticator(page);

  console.log(`[dev-session] signing up against ${ORIGIN} ...`);
  const { user, orgId } = await signUpAndOnboard(page, label);
  console.log(`[dev-session] signed up as ${user.email}, org ${orgId}`);

  mkdirSync(dirname(out), { recursive: true });
  await context.storageState({ path: out });
  writeFileSync(
    `${out}.meta.json`,
    JSON.stringify({ email: user.email, orgId, baseURL: ORIGIN }, null, 2),
  );

  await browser.close();
  console.log(`[dev-session] wrote ${out} and ${out}.meta.json`);
}

main().catch((error: unknown) => {
  console.error('[dev-session] failed:', error);
  process.exit(1);
});
