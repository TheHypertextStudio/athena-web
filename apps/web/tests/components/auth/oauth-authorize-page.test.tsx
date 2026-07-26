/**
 * Regression test: an unauthenticated visitor to the OAuth consent screen must be sent to
 * sign-in with the consent params preserved via `?callbackURL=`, so a successful sign-in returns
 * them to this exact screen instead of falling back to the home destination and silently
 * abandoning the third-party app's authorization request.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The mock mirrors Better Auth's real `useSession` shape, `error` included. It is not decoration:
 * the page distinguishes "the server said you have no session" from "the server never answered", and
 * a mock that omitted `error` would let a regression in that distinction pass unnoticed.
 */
interface MockSession {
  data: { user: { email: string } } | null;
  isPending: boolean;
  error: { status: number } | null;
}

const { metadataGet, replace, useSession } = vi.hoisted(() => ({
  metadataGet: vi.fn(),
  replace: vi.fn(),
  useSession: vi.fn((): MockSession => ({ data: null, isPending: false, error: null })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { oauth: { clients: { ':clientId': { metadata: { $get: metadataGet } } } } } },
}));

vi.mock('../../../src/lib/auth-client', () => ({
  useSession,
}));

import OAuthAuthorizePage from '../../../src/app/oauth/authorize/page';

const CONSENT_QUERY =
  '?consent_code=abc123&client_id=https%3A%2F%2Fclient.example&scope=work%3Aread';

beforeEach(() => {
  metadataGet.mockReset();
  metadataGet.mockResolvedValue({ ok: false });
  replace.mockReset();
  useSession.mockReset();
  useSession.mockReturnValue({ data: null, isPending: false, error: null });
  window.history.replaceState(null, '', `/oauth/authorize${CONSENT_QUERY}`);
});

afterEach(() => {
  cleanup();
});

describe('OAuthAuthorizePage', () => {
  it('sends an unauthenticated visitor to sign-in with the consent screen as ?callbackURL=', async () => {
    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        `/sign-in?callbackURL=${encodeURIComponent(`/oauth/authorize${CONSENT_QUERY}`)}`,
      );
    });
  });

  it('does not redirect while the session read is still pending', () => {
    useSession.mockReturnValue({ data: null, isPending: true, error: null });

    render(<OAuthAuthorizePage />);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect an authenticated visitor', async () => {
    useSession.mockReturnValue({
      data: { user: { email: 'ada@example.com' } },
      isPending: false,
      error: null,
    });

    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(metadataGet).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not abandon a consent grant because the session read failed', async () => {
    // Regression. This page used to gate on `!isPending && !session`, a boolean pair that cannot
    // tell "signed out" from "could not ask". A dropped connection or a 5xx on `/get-session` threw
    // an authenticated user out of a consent flow they were part-way through granting — and since
    // sign-in completes via fetch, the grant was simply lost. Only a server-confirmed sign-out may
    // redirect; an errored read keeps waiting.
    const failed: MockSession = { data: null, isPending: false, error: { status: 500 } };
    useSession.mockReturnValue(failed);

    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(useSession).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
