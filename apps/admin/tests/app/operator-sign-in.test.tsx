// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  signInPasskey: vi.fn<() => Promise<{ error?: unknown }>>(),
  signInSocial: vi.fn<() => Promise<{ error?: unknown }>>(),
  fetchAdminGoogleSso: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { passkey: mocks.signInPasskey, social: mocks.signInSocial } },
  useSession: () => ({ data: null, isPending: false }),
}));

vi.mock('@/lib/config', () => ({ fetchAdminGoogleSso: mocks.fetchAdminGoogleSso }));

import SignInPage from '@/app/(auth)/sign-in/page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** The rendered buttons, in DOM order. */
function buttons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

/** The button whose label mentions Google, if the console is offering one. */
function googleButton(container: HTMLElement): HTMLButtonElement | undefined {
  return buttons(container).find((b) => /google/i.test(b.textContent));
}

/** The passkey control, which must remain reachable on every path. */
function passkeyButton(container: HTMLElement): HTMLButtonElement | undefined {
  return buttons(container).find((b) => /passkey/i.test(b.textContent));
}

describe('operator sign-in', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom ships no WebAuthn, and without it the page disables the passkey control on capability
    // grounds — which would mask the thing these tests are actually about (whether `pending`
    // clears). Present a browser that supports passkeys but never offers conditional autofill.
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: () => Promise.resolve(false),
    });
    vi.stubGlobal('navigator', Object.create(navigator, { credentials: { value: {} } }));
    mocks.signInPasskey.mockResolvedValue({});
    mocks.signInSocial.mockResolvedValue({});
    mocks.fetchAdminGoogleSso.mockResolvedValue(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  /** Render the page and settle the config lookup its effect fires. */
  async function render(): Promise<void> {
    await act(async () => {
      root.render(<SignInPage />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('offers only the passkey path when the API reports operator SSO unconfigured', async () => {
    await render();

    expect(googleButton(container)).toBeUndefined();
    expect(passkeyButton(container)).toBeDefined();
  });

  it('offers Google alongside the passkey path when the API reports it configured', async () => {
    mocks.fetchAdminGoogleSso.mockResolvedValue(true);

    await render();

    expect(googleButton(container)).toBeDefined();
    // The break-glass path must survive: it is what still works when Workspace is what broke.
    expect(passkeyButton(container)).toBeDefined();
  });

  it('hands off to Google without leaving the console on a stale error', async () => {
    mocks.fetchAdminGoogleSso.mockResolvedValue(true);
    await render();

    await act(async () => {
      googleButton(container)?.click();
      await Promise.resolve();
    });

    expect(mocks.signInSocial).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/' });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('re-enables both controls when Google sign-in rejects outright', async () => {
    mocks.fetchAdminGoogleSso.mockResolvedValue(true);
    // A rejection, not a resolved error result — the path that used to strand the page with
    // every control disabled and nothing on screen to explain why.
    mocks.signInSocial.mockRejectedValue(new Error('provider detail that must stay private'));
    await render();

    await act(async () => {
      googleButton(container)?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('provider detail that must stay private');
    expect(googleButton(container)?.disabled).toBe(false);
    expect(passkeyButton(container)?.disabled).toBe(false);
  });
});
