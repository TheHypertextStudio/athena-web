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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { configGet, orgsGet, push, signInPasskey, signInSocial, useSession } = vi.hoisted(() => ({
  configGet: vi.fn(),
  orgsGet: vi.fn(),
  push: vi.fn(),
  signInPasskey: vi.fn(),
  signInSocial: vi.fn(),
  useSession: vi.fn((): { data: { user: { id: string } } | null; isPending: boolean } => ({
    data: null,
    isPending: false,
  })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../../../src/lib/api', () => ({
  api: { v1: { config: { $get: configGet }, orgs: { $get: orgsGet } } },
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: {
    signIn: { passkey: signInPasskey, social: signInSocial },
    useSession,
  },
}));

vi.mock('../../../src/app/(auth)/_lib/webauthn', () => ({
  isConditionalMediationSupported: async () => false,
  isWebAuthnSupported: () => true,
  signalUnknownPasskey: vi.fn(),
}));

import { SignInClient } from '../../../src/app/(auth)/sign-in/sign-in-client';

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

/**
 * Render `SignInClient` under a `QueryClientProvider`, as `providers.tsx` does in the app.
 *
 * @remarks
 * The screen reads `GET /v1/config` through the shared TanStack Query layer to decide which
 * identity-provider buttons this deployment can honestly offer, so it needs the provider even
 * though none of the assertions below are about those buttons. Retry-free, and with a fresh client
 * per render so one test's cached config never leaks into the next.
 */
function renderSignIn(): { rerender: () => void } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (
    <QueryClientProvider client={client}>
      <SignInClient />
    </QueryClientProvider>
  );
  const { rerender } = render(tree);
  return {
    rerender: () => {
      rerender(tree);
    },
  };
}

const ORIGINAL_LOCATION_DESCRIPTOR = Object.getOwnPropertyDescriptor(window, 'location');

/**
 * Swap `window.location` for a plain object that records `href` assignments instead of letting
 * jsdom attempt a real (unsupported) navigation. Restored by `afterEach` below.
 */
function mockLocationForHrefCapture(pathname: string, search: string): string[] {
  const assignments: string[] = [];
  const origin = window.location.origin;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin,
      pathname,
      search,
      set href(value: string) {
        assignments.push(value);
      },
    },
  });
  return assignments;
}

beforeEach(() => {
  configGet.mockReset();
  // No provider credentials, so the identity-provider block renders nothing and these tests see
  // exactly the passkey-only screen they were written against. `OAuthSignIn` has its own suite.
  configGet.mockResolvedValue(
    jsonResponse(200, { appMode: 'local', oauthProviders: [], connectors: [], mcpUrl: null }),
  );
  orgsGet.mockReset();
  push.mockReset();
  signInPasskey.mockReset();
  signInSocial.mockReset();
  useSession.mockReset();
  useSession.mockReturnValue({ data: null, isPending: false });
  window.history.replaceState(null, '', '/sign-in');
});

afterEach(() => {
  cleanup();
  if (ORIGINAL_LOCATION_DESCRIPTOR) {
    Object.defineProperty(window, 'location', ORIGINAL_LOCATION_DESCRIPTOR);
  }
});

describe('SignInClient', () => {
  it('redirects an already-authenticated browser away without rendering the passkey form', async () => {
    useSession.mockReturnValue({ data: { user: { id: 'user_1' } }, isPending: false });

    renderSignIn();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/today');
    });
    expect(signInPasskey).not.toHaveBeenCalled();
  });

  it('does not redirect while the session check is still pending', () => {
    useSession.mockReturnValue({ data: null, isPending: true });

    renderSignIn();

    expect(push).not.toHaveBeenCalled();
    // Throws if the passkey form isn't rendered — the assertion IS that this doesn't throw.
    screen.getByRole('button', { name: 'Sign in with a passkey' });
  });

  it('routes a signed-in user with no workspaces to onboarding', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(jsonResponse(200, { items: [] }));

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/onboarding');
    });
  });

  it('does not race the ceremony->onboarding push when useSession reports the just-minted session', async () => {
    // Regression test: the initial-session redirect must not stay reactive for the component's
    // whole lifetime, or it re-fires once the page's own ceremony mints a session and races
    // routeAfterSignIn's own push with a wrong one straight to /today.
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(jsonResponse(200, { items: [] }));

    const { rerender } = renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/onboarding');
    });
    push.mockClear();

    useSession.mockReturnValue({ data: { user: { id: 'user_1' } }, isPending: false });
    rerender();

    expect(push).not.toHaveBeenCalled();
  });

  it('waits for the session cookie to become readable before routing', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet
      .mockResolvedValueOnce(
        jsonResponse(401, { code: 'unauthorized', detail: 'Authentication required' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    renderSignIn();
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

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await expectSessionRecoveryError();
    expect(push).not.toHaveBeenCalled();
  });

  it('lets the user retry after a session recovery failure', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(
      jsonResponse(401, { code: 'unauthorized', detail: 'Authentication required' }),
    );

    renderSignIn();
    const button = screen.getByRole('button', { name: 'Sign in with a passkey' });
    fireEvent.click(button);

    await expectSessionRecoveryError();
    expect(button.hasAttribute('disabled')).toBe(false);

    fireEvent.click(button);

    await waitFor(() => {
      expect(signInPasskey).toHaveBeenCalledTimes(2);
    });
  });

  it('honors a safe ?callbackURL= return path after a successful passkey sign-in', async () => {
    window.history.replaceState(
      null,
      '',
      `/sign-in?callbackURL=${encodeURIComponent('/settings/athena?mcp=connected')}`,
    );
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(jsonResponse(200, { items: [{ id: 'org_1' }] }));

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/settings/athena?mcp=connected');
    });
  });

  it('falls back to /today when there is no ?callbackURL=', async () => {
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(jsonResponse(200, { items: [{ id: 'org_1' }] }));

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/today');
    });
  });

  it('falls back to /today when ?callbackURL= is an open redirect', async () => {
    window.history.replaceState(
      null,
      '',
      `/sign-in?callbackURL=${encodeURIComponent('//evil.example')}`,
    );
    signInPasskey.mockResolvedValue({ error: null });
    orgsGet.mockResolvedValue(jsonResponse(200, { items: [{ id: 'org_1' }] }));

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/today');
    });
  });

  it('resumes an in-flight MCP/OAuth authorization instead of routing to /today', async () => {
    // Regression test: Better Auth's oidc-provider plugin redirects an unauthenticated visitor
    // here with the raw OAuth request query (response_type/client_id/…), not ?callbackURL=. Its
    // own server-side auto-resume never fires because our ceremony completes via fetch(), not a
    // top-level navigation — so this page must detect that shape itself and hard-navigate back to
    // Better Auth's own endpoint, never falling through to the normal org-lookup routing.
    const search =
      '?response_type=code&client_id=mcp-client&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&scope=work%3Aread&state=xyz';
    window.history.replaceState(null, '', `/sign-in${search}`);
    const origin = window.location.origin;
    const assignments = mockLocationForHrefCapture('/sign-in', search);
    signInPasskey.mockResolvedValue({ error: null });

    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));

    await waitFor(() => {
      expect(assignments).toContain(`${origin}/api/auth/oauth2/authorize${search}`);
    });
    expect(orgsGet).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('resumes an in-flight MCP/OAuth authorization for an already-authenticated visitor', async () => {
    const search =
      '?response_type=code&client_id=mcp-client&redirect_uri=https%3A%2F%2Fclient.example%2Fcb';
    const origin = window.location.origin;
    const assignments = mockLocationForHrefCapture('/sign-in', search);
    useSession.mockReturnValue({ data: { user: { id: 'user_1' } }, isPending: false });

    renderSignIn();

    await waitFor(() => {
      expect(assignments).toContain(`${origin}/api/auth/oauth2/authorize${search}`);
    });
    expect(push).not.toHaveBeenCalled();
    expect(signInPasskey).not.toHaveBeenCalled();
  });
});
