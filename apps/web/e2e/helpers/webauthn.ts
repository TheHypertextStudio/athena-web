/**
 * WebAuthn primitives for the e2e specs.
 *
 * @remarks
 * The passwordless passkey ceremonies need a *virtual* authenticator so sign-up/sign-in/step-up run
 * headlessly without real hardware ({@link addVirtualAuthenticator}, installed per-test by
 * `fixtures.ts`). {@link clearVirtualCredentials} wipes the device to simulate a lost passkey (used
 * by the recovery spec), and {@link installSignalSpy} observes `signalUnknownCredential` calls (used
 * by the passkey-signal spec). The CDP session + authenticator id are tracked in a module-level
 * `WeakMap` keyed by page rather than monkey-patched onto the page object.
 */
import type { CDPSession, Page } from '@playwright/test';

/** Per-page CDP session + authenticator id, so a later `clearVirtualCredentials(page)` can reach it. */
const authenticators = new WeakMap<Page, { cdp: CDPSession; authenticatorId: string }>();

/**
 * Add a CDP WebAuthn virtual authenticator that auto-approves every ceremony.
 *
 * @remarks
 * Not bound to a relying party — created credentials take their RP from the ceremony, so the RP id
 * is whatever the app origin resolves to (see `constants.RP_ID`).
 *
 * @param page - The Playwright page to attach the authenticator to.
 * @returns the CDP authenticator id.
 */
export async function addVirtualAuthenticator(page: Page): Promise<string> {
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
  authenticators.set(page, { cdp, authenticatorId });
  return authenticatorId;
}

/**
 * Wipe every credential from the page's virtual authenticator — simulating a **lost device**.
 *
 * @remarks
 * The credential vanishes from the authenticator (as if the device were lost) but still exists
 * server-side, so a later passkey *registration* won't collide with it via `excludeCredentials`.
 * Use before driving the recovery flow, which enrols a fresh passkey on a clean device.
 *
 * @param page - A page whose {@link addVirtualAuthenticator} ran (via the base fixture).
 */
export async function clearVirtualCredentials(page: Page): Promise<void> {
  const wa = authenticators.get(page);
  if (!wa) throw new Error('clearVirtualCredentials: no virtual authenticator on this page');
  await wa.cdp.send('WebAuthn.clearCredentials', { authenticatorId: wa.authenticatorId });
}

declare global {
  interface Window {
    /** Options recorded by {@link installSignalSpy}; read back with `page.evaluate(() => window.signalCalls)`. */
    signalCalls?: unknown[];
  }
}

/**
 * Spy on `PublicKeyCredential.signalUnknownCredential` before any app code runs.
 *
 * @remarks
 * Installed via `addInitScript` so it wraps the static method on every navigation, before the app's
 * bundle loads. Each call's options are recorded on `window.signalCalls`, and the original method is
 * still invoked so the real credential-pruning behavior is preserved — the spy only observes.
 *
 * @param page - The Playwright page to instrument.
 */
export async function installSignalSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as Window & {
      PublicKeyCredential?: { signalUnknownCredential?: (options: unknown) => Promise<void> };
    };
    w.signalCalls = [];
    const ctor = w.PublicKeyCredential;
    if (!ctor) return;
    const original = ctor.signalUnknownCredential?.bind(ctor);
    ctor.signalUnknownCredential = (options: unknown) => {
      w.signalCalls?.push(options);
      return original ? original(options) : Promise.resolve();
    };
  });
}
