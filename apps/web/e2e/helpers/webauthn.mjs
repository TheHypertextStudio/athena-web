/**
 * Shared WebAuthn helpers for the e2e (Playwright/chromium) scripts.
 *
 * @remarks
 * The passwordless passkey ceremonies need a *virtual* authenticator so sign-up/sign-in run
 * headlessly without real hardware, and the Signal-API test needs to observe the browser's
 * `PublicKeyCredential.signalUnknownCredential` call. Both live here so the harness scripts
 * (`verify-composer.mjs`, `passkey-signal.mjs`) share one definition.
 */

/**
 * Add a CDP WebAuthn virtual authenticator that auto-approves every ceremony.
 *
 * @remarks
 * The authenticator is not bound to a relying party; created credentials take their RP from
 * the ceremony, so the RP ID is whatever the app origin resolves to (`docket.localhost`).
 *
 * @param page - The Playwright page to attach the authenticator to.
 * @returns the CDP authenticator id.
 */
export async function addVirtualAuthenticator(page) {
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
  // Stash the CDP session + id so a spec can later wipe the device's credentials
  // (see {@link clearVirtualCredentials}) to simulate a lost passkey.
  page.__webauthn = { cdp, authenticatorId };
  return authenticatorId;
}

/**
 * Wipe every credential from the page's virtual authenticator — simulating a **lost device**.
 *
 * @remarks
 * The credential vanishes from the authenticator (as if the device were lost) but still exists
 * server-side, so a later passkey *registration* won't collide with it via `excludeCredentials`.
 * Use this before driving the recovery flow, which enrols a fresh passkey on a clean device.
 *
 * @param page - A page whose `addVirtualAuthenticator` ran (via the base fixture).
 */
export async function clearVirtualCredentials(page) {
  const wa = page.__webauthn;
  if (!wa) throw new Error('clearVirtualCredentials: no virtual authenticator on this page');
  await wa.cdp.send('WebAuthn.clearCredentials', { authenticatorId: wa.authenticatorId });
}

/**
 * Spy on `PublicKeyCredential.signalUnknownCredential` before any app code runs.
 *
 * @remarks
 * Installed via `addInitScript` so it wraps the static method on every subsequent navigation,
 * before the app's bundle loads. Each call's options are recorded on `window.signalCalls`,
 * and the original method is still invoked so the real credential-pruning behavior is
 * preserved — the flow stays real; the spy only observes it. Read the calls back with
 * `page.evaluate(() => window.signalCalls)`.
 *
 * @param page - The Playwright page to instrument.
 */
export async function installSignalSpy(page) {
  await page.addInitScript(() => {
    window.signalCalls = [];
    const PublicKeyCredentialCtor = window.PublicKeyCredential;
    if (!PublicKeyCredentialCtor) return;
    const original = PublicKeyCredentialCtor.signalUnknownCredential?.bind(PublicKeyCredentialCtor);
    PublicKeyCredentialCtor.signalUnknownCredential = (options) => {
      window.signalCalls.push(options);
      return original ? original(options) : Promise.resolve();
    };
  });
}
