/**
 * Autonomous visual-verification harness for the create-task composer.
 *
 * Launches an isolated, headless Chromium (never the developer's personal browser), installs a
 * CDP WebAuthn *virtual authenticator* so the passwordless passkey sign-up/sign-in ceremonies
 * complete without a real device, signs up a throwaway local account (the dev DB is embedded
 * pglite — disposable), takes the "Just me" onboarding fork to mint an org, then opens the New
 * task composer and screenshots it (light, dark, and the dirty-draft discard confirmation).
 *
 * Usage: node apps/web/e2e/verify-composer.mjs [outDir]
 */
import { chromium } from '@playwright/test';

const BASE = process.env.APP_URL ?? 'https://docket.localhost';
const OUT = process.argv[2] ?? '.';
const stamp = Date.now();

/** Add a CDP WebAuthn virtual authenticator that auto-approves every ceremony. */
async function addVirtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
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
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [console.${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  page.on('requestfailed', (r) => console.log(`  [reqfailed] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`));

  // Capture the org id the onboarding wizard mints (POST /v1/orgs), so we can deep-link My Work.
  let orgId = null;
  page.on('response', async (res) => {
    try {
      if (res.request().method() === 'POST' && /\/v1\/orgs(\?|$)/.test(res.url()) && res.ok()) {
        const json = await res.json();
        if (json?.organization?.id) orgId = json.organization.id;
      }
    } catch {
      /* non-JSON or already consumed */
    }
  });

  await addVirtualAuthenticator(page);

  console.log('→ sign-up');
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  const createBtn = page.getByRole('button', { name: 'Create account' });
  // The form is controlled; filling before React hydrates gets clobbered back to empty. Re-fill
  // until the submit button actually enables (hydrated + WebAuthn-supported + non-empty fields).
  let enabled = false;
  for (let i = 0; i < 25 && !enabled; i++) {
    await page.fill('#name', 'Composer Verifier');
    await page.fill('#email', `verify+${stamp}@example.com`);
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
  if (reached !== 'onboarding') {
    const alertText = await page
      .locator('[role="alert"]')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(`sign-up did not reach onboarding (url=${page.url()}); alerts=${JSON.stringify(alertText)}`);
  }
  console.log('→ onboarding');
  await page.getByText('Just me', { exact: false }).first().click();
  await page.getByRole('button', { name: /Create your space|Continue/ }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click({ timeout: 45_000 });

  // Wait for the org id to arrive from the create-org response.
  for (let i = 0; i < 50 && !orgId; i++) await page.waitForTimeout(200);
  if (!orgId) throw new Error('Did not capture an org id from POST /v1/orgs');
  console.log(`→ org ${orgId}`);

  await page.goto(`${BASE}/orgs/${orgId}/my-work`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600); // let the shell + sidebar settle

  // Full app frame (sidebar nav + content) so the new indigo accent — active nav item,
  // focus, surface-tint — is visible, not just the composer.
  console.log('→ screenshot: app frame light');
  await page.screenshot({ path: `${OUT}/app-light-${stamp}.png` });
  console.log('→ screenshot: app frame dark');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/app-dark-${stamp}.png` });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.waitForTimeout(150);

  await page.getByRole('button', { name: 'New task' }).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Task title').waitFor();
  await page.waitForTimeout(400); // let the open animation settle

  console.log('→ screenshot: light');
  await dialog.screenshot({ path: `${OUT}/composer-light-${stamp}.png` });

  console.log('→ screenshot: dark');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(250);
  await dialog.screenshot({ path: `${OUT}/composer-dark-${stamp}.png` });

  console.log('→ screenshot: dirty-draft discard confirm');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await dialog.getByPlaceholder('Task title').fill('Ship the launch page');
  await dialog.getByPlaceholder('Add a description…').fill('Draft copy + hero, then hand to design.');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await dialog.screenshot({ path: `${OUT}/composer-discard-${stamp}.png` });

  console.log(
    `OK\n${OUT}/composer-light-${stamp}.png\n${OUT}/composer-dark-${stamp}.png\n${OUT}/composer-discard-${stamp}.png`,
  );
  await browser.close();
}

main().catch(async (err) => {
  console.error('FAILED:', err?.message ?? err);
  if (page) {
    try {
      await page.screenshot({ path: `${OUT}/composer-FAILURE-${stamp}.png`, fullPage: true });
      console.error(`  failure screenshot: ${OUT}/composer-FAILURE-${stamp}.png`);
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 1;
});
