/**
 * Behavior tests for the identity-provider sign-in controls.
 *
 * @remarks
 * The invariant under test is availability, not chrome. A provider button is a promise that the
 * ceremony behind it can complete, and the only thing that knows whether it can is the server:
 * `GET /v1/config` lists a provider iff its OAuth client id *and* secret are really configured.
 * Rendering a button the deployment cannot honour is the connector-reliability failure mode wearing
 * a different hat — it looks like it works right up until the redirect, and then it is a dead end.
 *
 * Google carries a second gate. `canUseGoogleOAuth` (`packages/auth`) admits only an allowlist of
 * emails while `GOOGLE_OAUTH_PUBLIC` is false in production, and the sign-in screen has no email to
 * test against, so the button must be withheld until the stage opens rather than offered to
 * everyone and refused for most.
 */
import type { PublicConfigOut } from '@docket/identity-access/public-config-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { configGet, signInSocial } = vi.hoisted(() => ({
  configGet: vi.fn(),
  signInSocial: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { config: { $get: configGet } } },
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { signIn: { social: signInSocial } },
}));

import { OAuthSignIn, isOfferable } from '../../../src/app/(auth)/_components/oauth-sign-in';

/** A public config with the given providers, defaulting to a non-production deployment. */
function config(overrides: Partial<PublicConfigOut> = {}): PublicConfigOut {
  return {
    appMode: 'local',
    oauthProviders: [],
    googleServerClientId: null,
    connectors: [],
    mcpUrl: null,
    ...overrides,
  };
}

/** A `Response`-like stub whose `ok`/`status`/`json()` the query layer reads. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderOAuth(): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (
    <QueryClientProvider client={client}>
      <OAuthSignIn />
    </QueryClientProvider>
  );
  render(tree);
  return tree;
}

beforeEach(() => {
  configGet.mockReset();
  signInSocial.mockReset();
  signInSocial.mockResolvedValue({ error: null });
  window.history.replaceState(null, '', '/sign-in');
});

afterEach(cleanup);

describe('isOfferable', () => {
  it('withholds a provider the server has no credentials for', () => {
    expect(isOfferable(config({ oauthProviders: ['github'] }), 'google')).toBe(false);
    expect(isOfferable(config({ oauthProviders: ['github'] }), 'github')).toBe(true);
  });

  it('withholds Google in production until the stage is public', () => {
    const staged = config({
      appMode: 'production',
      oauthProviders: ['google'],
      googleOAuthPublic: false,
    });
    // `canUseGoogleOAuth` would refuse every email outside GOOGLE_OAUTH_TEST_EMAILS, and sign-in
    // has no email yet, so the honest pre-identity answer is "do not offer it".
    expect(isOfferable(staged, 'google')).toBe(false);
    expect(isOfferable({ ...staged, googleOAuthPublic: true }, 'google')).toBe(true);
  });

  it('offers Google outside production, where the allowlist does not apply', () => {
    expect(isOfferable(config({ appMode: 'local', oauthProviders: ['google'] }), 'google')).toBe(
      true,
    );
  });

  it('does not apply the Google stage gate to the other providers', () => {
    const staged = config({
      appMode: 'production',
      oauthProviders: ['github', 'linear', 'apple'],
      googleOAuthPublic: false,
    });
    expect(isOfferable(staged, 'github')).toBe(true);
    expect(isOfferable(staged, 'linear')).toBe(true);
    expect(isOfferable(staged, 'apple')).toBe(true);
  });
});

describe('OAuthSignIn', () => {
  it('renders nothing when the deployment has configured no providers', async () => {
    configGet.mockResolvedValue(jsonResponse(config()));

    renderOAuth();

    await waitFor(() => {
      expect(configGet).toHaveBeenCalled();
    });
    expect(screen.queryByText('or continue with')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders exactly the providers the server advertises', async () => {
    configGet.mockResolvedValue(jsonResponse(config({ oauthProviders: ['google', 'github'] })));

    renderOAuth();

    await screen.findByRole('button', { name: 'Continue with Google' });
    screen.getByRole('button', { name: 'Continue with GitHub' });
    expect(screen.queryByRole('button', { name: 'Continue with Linear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
  });

  it('starts the ceremony with a session-resolving return destination', async () => {
    configGet.mockResolvedValue(jsonResponse(config({ oauthProviders: ['google'] })));

    renderOAuth();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => {
      expect(signInSocial).toHaveBeenCalledWith({
        provider: 'google',
        // `/open` reads the session server-side and redirects, so the destination is decided with
        // the session in hand rather than guessed before the ceremony starts.
        callbackURL: '/open',
        newUserCallbackURL: '/onboarding',
      });
    });
  });

  it('returns the person to where they were headed when bounced out of a protected route', async () => {
    window.history.replaceState(null, '', '/sign-in?callbackURL=%2Ftasks');
    configGet.mockResolvedValue(jsonResponse(config({ oauthProviders: ['google'] })));

    renderOAuth();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => {
      expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: '/tasks' }));
    });
  });

  it('refuses an open redirect smuggled through ?callbackURL=', async () => {
    window.history.replaceState(null, '', '/sign-in?callbackURL=https%3A%2F%2Fevil.example%2Fx');
    configGet.mockResolvedValue(jsonResponse(config({ oauthProviders: ['google'] })));

    renderOAuth();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => {
      expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ callbackURL: '/open' }));
    });
  });

  it('surfaces application-owned copy when the ceremony cannot be started', async () => {
    configGet.mockResolvedValue(jsonResponse(config({ oauthProviders: ['google'] })));
    signInSocial.mockRejectedValue(new Error('getaddrinfo ENOTFOUND accounts.google.com'));

    renderOAuth();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    const alert = await screen.findByRole('alert');
    // The provider's own exception text must never reach the screen.
    expect(alert.textContent).toBe('We could not start that sign-in. Please try again.');
    expect(alert.textContent).not.toContain('ENOTFOUND');
    // The button comes back so the person can retry rather than being left on a dead screen.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Continue with Google' }).hasAttribute('disabled'),
      ).toBe(false);
    });
  });

  it('locks every provider while one ceremony is starting', async () => {
    configGet.mockResolvedValue(jsonResponse(config({ oauthProviders: ['google', 'github'] })));
    // Never settles: the ceremony is a full-page navigation, so "in flight" is the terminal state.
    signInSocial.mockReturnValue(
      new Promise(() => {
        // Intentionally never resolved.
      }),
    );

    renderOAuth();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    await screen.findByRole('button', { name: 'Opening Google…' });
    expect(
      screen.getByRole('button', { name: 'Continue with GitHub' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
