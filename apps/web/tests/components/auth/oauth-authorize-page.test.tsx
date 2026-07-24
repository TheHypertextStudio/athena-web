/**
 * Regression test: an unauthenticated visitor to the OAuth consent screen must be sent to
 * sign-in with the consent params preserved via `?callbackURL=`, so a successful sign-in returns
 * them to this exact screen instead of falling back to the home destination and silently
 * abandoning the third-party app's authorization request.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { metadataGet, replace, useSession } = vi.hoisted(() => ({
  metadataGet: vi.fn(),
  replace: vi.fn(),
  useSession: vi.fn((): { data: { user: { email: string } } | null; isPending: boolean } => ({
    data: null,
    isPending: false,
  })),
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
  useSession.mockReturnValue({ data: null, isPending: false });
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
    useSession.mockReturnValue({ data: null, isPending: true });

    render(<OAuthAuthorizePage />);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does not redirect an authenticated visitor', async () => {
    useSession.mockReturnValue({ data: { user: { email: 'ada@example.com' } }, isPending: false });

    render(<OAuthAuthorizePage />);

    await waitFor(() => {
      expect(metadataGet).toHaveBeenCalled();
    });
    expect(replace).not.toHaveBeenCalled();
  });
});
