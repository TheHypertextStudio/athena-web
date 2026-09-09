/**
 * Exercise the real browser FedCM ceremony and Docket's real Lattice device request headlessly.
 *
 * APP_URL is required. LATTICE_BROWSER_STORAGE_STATE may point to an ordinary Playwright export
 * from an already authenticated test browser. This script never reads browser cookie databases,
 * invents a session, replaces navigator.credentials.get, or substitutes provider responses.
 * LATTICE_TEST_ACCOUNT_EMAIL selects an account when the native chooser offers several.
 * New consent is approved only with the operator's explicit LATTICE_TEST_ALLOW_CONSENT=true.
 * LATTICE_TEST_CONSENT_ORIGIN must identify the provider's trusted Accounts UI for that approval.
 */
import { chromium, type Page, type CDPSession, type BrowserContext } from '@playwright/test';
import { isProviderConsentUrl } from './consent-policy';

interface NativeDialog {
  readonly dialogId: string;
  readonly dialogType: string;
  readonly accounts: readonly { readonly email: string; readonly idpConfigUrl: string }[];
}

/** Wait for the real application to be signed in before starting an authorization attempt. */
async function requireDocketSession(page: Page, appUrl: string): Promise<void> {
  await page.goto(new URL('/settings/athena', appUrl).href, { waitUntil: 'domcontentloaded' });
  const url = new URL(page.url());
  if (url.pathname === '/sign-in' || url.pathname === '/sign-up') {
    throw new Error(
      'Docket sign-in required: supply a normal authenticated test browser storage state.',
    );
  }
}

/** Select only the intended account in Chromium's actual native chooser. */
async function selectNativeAccount(cdp: CDPSession, dialog: NativeDialog): Promise<void> {
  console.log(
    JSON.stringify({
      stage: 'native_dialog',
      type: dialog.dialogType,
      accounts: dialog.accounts.length,
    }),
  );
  if (dialog.dialogType !== 'AccountChooser' || dialog.accounts.length === 0) {
    throw new Error('Lovelace sign-in required before an account can be selected.');
  }
  const accountEmail = process.env['LATTICE_TEST_ACCOUNT_EMAIL'];
  const accountIndex = accountEmail
    ? dialog.accounts.findIndex((account) => account.email === accountEmail)
    : dialog.accounts.length === 1
      ? 0
      : -1;
  if (accountIndex < 0)
    throw new Error('Set LATTICE_TEST_ACCOUNT_EMAIL to one offered test account.');
  await cdp.send('FedCm.selectAccount', { dialogId: dialog.dialogId, accountIndex });
}

/** Approve only the selected provider's real continuation popup. */
async function approveProviderConsent(popup: Page, providerOrigin: string): Promise<void> {
  if (process.env['LATTICE_TEST_ALLOW_CONSENT'] !== 'true') {
    throw new Error('Provider consent requires operator approval.');
  }
  const configuredConsentOrigin = process.env['LATTICE_TEST_CONSENT_ORIGIN'];
  if (!configuredConsentOrigin) {
    throw new Error('LATTICE_TEST_CONSENT_ORIGIN is required before approving consent.');
  }
  const consentOrigin = new URL(configuredConsentOrigin).origin;
  await popup.waitForURL((url) => isProviderConsentUrl(url, providerOrigin, consentOrigin), {
    timeout: 30_000,
  });
  await popup.getByRole('button', { name: 'Allow Access', exact: true }).click({ timeout: 30_000 });
}

/** Verify Docket can make an authenticated request to the user's actual Lattice gateway. */
async function requireLatticeDevices(context: BrowserContext, appUrl: string): Promise<void> {
  const response = await context.request.get(new URL('/v1/me/athena/lattice/devices', appUrl).href);
  const body = (await response.json()) as {
    readonly devices?: readonly { readonly ready?: boolean }[];
    readonly unavailableReason?: string | null;
  };
  if (!response.ok() || body.unavailableReason || !Array.isArray(body.devices)) {
    throw new Error(
      `Lattice device request failed: ${body.unavailableReason ?? 'invalid_response'}.`,
    );
  }
  console.log(
    JSON.stringify({
      stage: 'lattice_devices',
      count: body.devices.length,
      reachable: body.devices.filter((device: { readonly ready?: boolean }) => device.ready).length,
    }),
  );
}

/** Run one real connection attempt; output only coarse status, never tokens or account details. */
async function main(): Promise<void> {
  const appUrl = process.env['APP_URL'];
  if (!appUrl) throw new Error('APP_URL is required.');
  const storageState = process.env['LATTICE_BROWSER_STORAGE_STATE'];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ...(storageState ? { storageState } : {}) });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('FedCm.enable', { disableRejectionDelay: true });
    await requireDocketSession(page, appUrl);

    const dialogPromise = new Promise<NativeDialog>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('No native FedCM dialog was emitted.'));
      }, 30_000);
      cdp.once('FedCm.dialogShown', (dialog: NativeDialog) => {
        clearTimeout(timeout);
        resolve(dialog);
      });
    });
    // Attach a rejection handler before the click can fail, avoiding an orphaned timer rejection.
    void dialogPromise.catch(() => undefined);
    const completionPromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/v1/me/athena/lattice/authorize/code',
      { timeout: 60_000 },
    );
    void completionPromise.catch(() => undefined);

    await page
      .getByRole('button', { name: /^(Connect with Lovelace|Reconnect Lovelace)$/ })
      .click();
    const dialog = await dialogPromise;
    const providerConfig = dialog.accounts[0]?.idpConfigUrl;
    if (providerConfig) {
      const providerOrigin = new URL(providerConfig).origin;
      context.on('page', (popup) => {
        void approveProviderConsent(popup, providerOrigin).catch(() => {
          console.log(JSON.stringify({ stage: 'provider_consent', status: 'incomplete' }));
        });
      });
    }
    await selectNativeAccount(cdp, dialog);

    const completion = await completionPromise;
    const result = (await completion.json()) as { readonly status?: string };
    if (!completion.ok() || result.status !== 'connected') {
      throw new Error('Docket did not finish the authorization code exchange.');
    }
    console.log(JSON.stringify({ stage: 'authorization', status: 'connected' }));

    await requireLatticeDevices(context, appUrl);
  } finally {
    await browser.close();
  }
}

await main();
