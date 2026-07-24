/**
 * Behavior tests for the passkey sign-in landing decision.
 *
 * @remarks
 * After Better Auth reports a successful passkey ceremony, the page performs one authenticated
 * `/v1/orgs` read to decide whether to land in Today or first-run onboarding. A 401 there means
 * the session cookie did not stick; it must stay on sign-in with an auth error instead of routing
 * into onboarding, where the first create-org call would surface the confusing
 * "Authentication required" notice.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orgsGet, push, signInPasskey } = vi.hoisted(() => ({
  orgsGet: vi.fn(),
  push: vi.fn(),
  signInPasskey: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { orgs: { $get: orgsGet } } },
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { signIn: { passkey: signInPasskey } },
}));

const { oauthButtonsSpy } = vi.hoisted(() => ({
  oauthButtonsSpy: vi.fn(),
}));

vi.mock('../../../src/app/(auth)/_components/oauth-buttons', () => ({
  OAuthButtons: (props: { callbackURL: string }) => {
    oauthButtonsSpy(props);
    return null;
  },
}));

vi.mock('../../../src/app/(auth)/_lib/webauthn', () => ({
  isConditionalMediationSupported: async () => false,
  isWebAuthnSupported: () => true,
  signalUnknownPasskey: vi.fn(),
}));

import SignInPage from '../../../src/app/(auth)/sign-in/page';

/** A `Response`-like stub whose `ok`/`status`/`json()` the page reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function expectSessionRecoveryError(): Promise<void> {
  await waitFor(
    () => {
      expect(screen.getByRole('alert').textContent).toBe(
        'We could not finish signing you in. Please try again.',
      );
    },
    { timeout: 5_000 },
  );
}

beforeEach(() => {
  orgsGet.mockReset();
  push.mockReset();
  signInPasskey.mockReset();
  oauthButtonsSpy.mockReset();
  window.history.replaceState(null, '', '/sign-in');
});

afterEach(() => {
  cleanup();
});

describe('SignInPage', () => {
  it('routes a signed-in user with no workspaces to onboarding', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(jsonResponse(200, { items: [] }));

    render(<SignInPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('waits for the session cookie to become readable before routing', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet
      .mockResolvedValueOnce(
        jsonResponse(401, { code: 'unauthorized', detail: 'Authentication required' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    render(<SignInPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/onboarding');
    });
    expect(orgsGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays on sign-in when the post-passkey org lookup is unauthenticated', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(
      jsonResponse(401, { code: 'unauthorized', detail: 'Authentication required' }),
    );

    render(<SignInPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await expectSessionRecoveryError();
    expect(push).not.toHaveBeenCalled();
  });

  it('lets the user retry after a session recovery failure', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(
      jsonResponse(401, { code: 'unauthorized', detail: 'Authentication required' }),
    );

    render(<SignInPage />);
    const button = screen.getByRole('button', { name: 'Sign in with a passkey' });
    fireEvent.click(button);

    await expectSessionRecoveryError();
    expect(button.hasAttribute('disabled')).toBe(false);

    fireEvent.click(button);

    await waitFor(() => {
      expect(signInPasskey).toHaveBeenCalledTimes(2);
    });
  });

  it('passes a safe ?callbackURL= return path through to the OAuth buttons', () => {
    window.history.replaceState(
      null,
      '',
      `/sign-in?callbackURL=${encodeURIComponent('/settings/athena?mcp=connected')}`,
    );

    render(<SignInPage />);

    expect(oauthButtonsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: '/settings/athena?mcp=connected' }),
    );
  });

  it('falls back to /today for the OAuth buttons when there is no ?callbackURL=', () => {
    render(<SignInPage />);

    expect(oauthButtonsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: '/today' }),
    );
  });

  it('falls back to /today for the OAuth buttons when ?callbackURL= is an open redirect', () => {
    window.history.replaceState(
      null,
      '',
      `/sign-in?callbackURL=${encodeURIComponent('//evil.example')}`,
    );

    render(<SignInPage />);

    expect(oauthButtonsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: '/today' }),
    );
  });
});
