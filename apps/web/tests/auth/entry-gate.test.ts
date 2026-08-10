/**
 * The server-side entry gate's redirect decisions.
 *
 * @remarks
 * These are the assertions that hold the launch fix in place. Two defects were measured against the
 * running app and both were client-side redirects, which by construction paint before they move:
 * `/sign-in` with a valid session painted its full card at ~75ms and only reached `/today` at
 * ~483ms, and the landing CTA advertised `href="/sign-up"` for the first ~345ms of every load.
 * Deciding on the server removes the paint entirely — but only while every branch below stays true.
 *
 * The `'unknown'` branches matter as much as the redirecting ones. A gate that redirects when it
 * could not reach its own API is a gate that signs people out during a hiccup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ServerSessionModule from '../../src/lib/server-session';
import type { ServerSessionState } from '../../src/lib/server-session';

/** Thrown by the `redirect` mock so control flow matches Next's real, throwing `redirect()`. */
class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super('redirect');
  }
}

const { readServerSessionMock, redirectMock, headersMock, prefetchQuery, orgsGet } = vi.hoisted(
  () => ({
    readServerSessionMock: vi.fn(),
    // Implementation is installed in `beforeEach` so it can throw the `RedirectSignal` declared
    // below — hoisted factories run before this module's own bindings exist.
    redirectMock: vi.fn(),
    headersMock: vi.fn(),
    prefetchQuery: vi.fn(),
    orgsGet: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/headers', () => ({ headers: headersMock, cookies: vi.fn() }));

vi.mock('../../src/lib/server-session', async () => {
  // `safeServerReturnPath` stays real: the open-redirect guard is the thing under test here, not a
  // seam to stub out.
  const actual = await vi.importActual<typeof ServerSessionModule>('../../src/lib/server-session');
  return { ...actual, readServerSession: readServerSessionMock };
});

vi.mock('../../src/components/app-shell-frame', () => ({
  AppShellFrame: function AppShellFrameStub(): null {
    return null;
  },
}));

// The layout wraps the shell in the app's location provider, which reads Next's router for its
// change notification. Nothing here exercises navigation, so it stands in as a passthrough.
vi.mock('../../src/lib/app-location', () => ({
  AppLocationProvider: function AppLocationProviderStub({
    children,
  }: {
    children: unknown;
  }): unknown {
    return children;
  },
}));

vi.mock('../../src/lib/query-server', () => ({
  getServerQueryClient: () => ({ prefetchQuery }),
  getServerApi: async () => ({ v1: { orgs: { $get: orgsGet } } }),
  dehydrate: () => ({ queries: [] }),
}));

vi.mock('../../src/lib/query-core', () => ({ unwrap: vi.fn() }));

import AppGroupLayout from '../../src/app/(app)/layout';
import SignInPage from '../../src/app/(auth)/sign-in/page';
import SignUpPage from '../../src/app/(auth)/sign-up/page';
import FocusGroupLayout from '../../src/app/(focus)/layout';
import OpenPage from '../../src/app/open/page';
import { config, isProtectedPath, proxy } from '../../src/proxy';

/** Every auth screen the gate guards, exercised identically. */
const AUTH_PAGES = [
  { name: 'sign-in', page: SignInPage },
  { name: 'sign-up', page: SignUpPage },
] as const;

const AUTHENTICATED: ServerSessionState = {
  state: 'authenticated',
  user: { userId: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
};

/** Run an auth page and report the redirect destination, or `null` when it rendered instead. */
async function runAuthPage(
  page: (props: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }) => Promise<unknown>,
  query: Record<string, string | string[] | undefined>,
): Promise<string | null> {
  try {
    await page({ searchParams: Promise.resolve(query) });
    return null;
  } catch (caught) {
    if (caught instanceof RedirectSignal) return caught.destination;
    throw caught;
  }
}

beforeEach(() => {
  readServerSessionMock.mockReset();
  redirectMock.mockReset();
  redirectMock.mockImplementation((destination: string): never => {
    throw new RedirectSignal(destination);
  });
  headersMock.mockReset();
  headersMock.mockResolvedValue({ get: () => null });
  prefetchQuery.mockReset();
  prefetchQuery.mockResolvedValue(undefined);
  orgsGet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(AUTH_PAGES)('$name page (server guard)', ({ page }) => {
  it('redirects an authenticated visitor to the app before rendering anything', async () => {
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    await expect(runAuthPage(page, {})).resolves.toBe('/today');
  });

  it('honors a safe same-origin callbackURL', async () => {
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    await expect(
      runAuthPage(page, { callbackURL: '/settings/athena?mcp=connected' }),
    ).resolves.toBe('/settings/athena?mcp=connected');
  });

  it.each(['//evil.example', 'https://evil.example/steal', '/\\evil.example'])(
    'falls back to /today for the open redirect %s',
    async (callbackURL) => {
      readServerSessionMock.mockResolvedValue(AUTHENTICATED);

      await expect(runAuthPage(page, { callbackURL })).resolves.toBe('/today');
    },
  );

  it('renders rather than redirecting an in-flight OAuth authorization', async () => {
    // Better Auth's oauthProvider sends the original request's raw query here. Redirecting to
    // /today would silently abandon the grant the calling client is waiting on.
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    await expect(
      runAuthPage(page, {
        response_type: 'code',
        client_id: 'mcp-client',
        redirect_uri: 'https://client.example/cb',
      }),
    ).resolves.toBeNull();
    expect(readServerSessionMock).not.toHaveBeenCalled();
  });

  it('still redirects when only one of the OAuth resume params is present', async () => {
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    await expect(runAuthPage(page, { response_type: 'code' })).resolves.toBe('/today');
    await expect(runAuthPage(page, { client_id: 'mcp-client' })).resolves.toBe('/today');
  });

  it.each<ServerSessionState>([{ state: 'signed-out' }, { state: 'unknown' }])(
    'renders the form for %o',
    async (state) => {
      readServerSessionMock.mockResolvedValue(state);

      await expect(runAuthPage(page, {})).resolves.toBeNull();
    },
  );
});

describe('(app) layout guard', () => {
  it('redirects a signed-out request to sign-in with a callbackURL back to where it was headed', async () => {
    readServerSessionMock.mockResolvedValue({ state: 'signed-out' });
    headersMock.mockResolvedValue({
      get: (name: string) => (name === 'x-docket-pathname' ? '/settings/athena?tab=mcp' : null),
    });

    await expect(AppGroupLayout({ children: null })).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith(
      `/sign-in?callbackURL=${encodeURIComponent('/settings/athena?tab=mcp')}`,
    );
  });

  it('falls back to /today when the middleware supplied no pathname header', async () => {
    readServerSessionMock.mockResolvedValue({ state: 'signed-out' });

    await expect(AppGroupLayout({ children: null })).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith(
      `/sign-in?callbackURL=${encodeURIComponent('/today')}`,
    );
  });

  it('renders with no server identity when the session read is unknown, and never redirects', async () => {
    // Redirecting on "could not ask" is what makes an app sign people out during an API hiccup.
    readServerSessionMock.mockResolvedValue({ state: 'unknown' });

    const tree = await AppGroupLayout({ children: null });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(shellProps(tree).initialSession).toBeNull();
  });

  it('hands the confirmed identity to the shell so it never paints an identity skeleton', async () => {
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    const tree = await AppGroupLayout({ children: null });

    expect(shellProps(tree).initialSession).toEqual(AUTHENTICATED.user);
  });

  it('prefetches the orgs under the exact key the shell reads, or hydration is a no-op', async () => {
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    await AppGroupLayout({ children: null });

    expect(prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['me', 'orgs'] }),
    );
  });
});

describe('(focus) layout guard', () => {
  it('protects the chrome-free route with a callback to Focus', async () => {
    readServerSessionMock.mockResolvedValue({ state: 'signed-out' });
    headersMock.mockResolvedValue({
      get: (name: string) => (name === 'x-docket-pathname' ? '/focus?mode=popout' : null),
    });

    await expect(FocusGroupLayout({ children: null })).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith(
      `/sign-in?callbackURL=${encodeURIComponent('/focus?mode=popout')}`,
    );
  });

  it('keeps rendering on an unknown session and hydrates the organization query', async () => {
    readServerSessionMock.mockResolvedValue({ state: 'unknown' });

    await expect(FocusGroupLayout({ children: null })).resolves.toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['me', 'orgs'] }),
    );
  });
});

/**
 * The `AppShellFrame` element's props, found by descending the layout's wrappers.
 *
 * @remarks
 * Searches rather than indexing a fixed depth. The layout wraps the shell in a hydration boundary
 * and a location provider today, and an earlier version of this helper asserted that exact nesting
 * — so adding a provider broke two tests that have nothing to do with providers.
 */
function shellProps(tree: unknown): { initialSession: unknown } {
  let node = tree;
  for (let depth = 0; depth < 10; depth += 1) {
    const element = node as { props?: Record<string, unknown> } | null;
    if (element?.props && 'initialSession' in element.props) {
      return element.props as { initialSession: unknown };
    }
    if (!element?.props || !('children' in element.props)) {
      break;
    }
    node = element.props['children'];
  }
  throw new Error('The layout rendered no element carrying initialSession.');
}

describe('/open entry gateway', () => {
  /** Run the gateway and report where it redirected. It never returns markup. */
  async function runOpen(): Promise<string> {
    try {
      await OpenPage();
    } catch (caught) {
      if (caught instanceof RedirectSignal) return caught.destination;
      throw caught;
    }
    throw new Error('/open rendered instead of redirecting');
  }

  it('sends a confirmed session straight into the app', async () => {
    readServerSessionMock.mockResolvedValue(AUTHENTICATED);

    await expect(runOpen()).resolves.toBe('/today');
  });

  it.each<ServerSessionState>([{ state: 'signed-out' }, { state: 'unknown' }])(
    'sends %o to sign-up, never to an auth screen the app would bounce them off',
    async (state) => {
      readServerSessionMock.mockResolvedValue(state);

      await expect(runOpen()).resolves.toBe('/sign-up');
    },
  );
});

describe('protected-path matcher', () => {
  const SEGMENTS = [
    'today',
    'focus',
    'inbox',
    'stream',
    'portfolio',
    'tasks',
    'calendar',
    'search',
    'settings',
    'athena',
    'exports',
    'workspaces',
    'orgs',
  ];

  it('covers every (app) segment as both the bare path and its subtree', () => {
    // Next statically analyses `config`, so the matcher cannot be derived from the runtime list.
    // This is what keeps the two from drifting: a new (app) segment must appear in both.
    for (const segment of SEGMENTS) {
      expect(config.matcher).toContain(`/${segment}`);
      expect(config.matcher).toContain(`/${segment}/:path*`);
      expect(isProtectedPath(`/${segment}`)).toBe(true);
      expect(isProtectedPath(`/${segment}/anything/deeper`)).toBe(true);
    }
  });

  it('keeps the reverse-proxied API paths matched', () => {
    expect(config.matcher).toContain('/api/auth/:path*');
    expect(config.matcher).toContain('/v1/:path*');
  });

  it('leaves the public and entry surfaces alone', () => {
    for (const path of ['/', '/sign-in', '/sign-up', '/open', '/onboarding', '/pricing']) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it('does not treat a lookalike prefix as a protected segment', () => {
    expect(isProtectedPath('/todays-plan')).toBe(false);
    expect(isProtectedPath('/settings-export')).toBe(false);
  });
});

describe('proxy (middleware) session gate', () => {
  /** A `NextRequest` stand-in exposing only what {@link proxy} reads. */
  function request(options: {
    pathname: string;
    search?: string;
    cookies?: string[];
    headers?: Record<string, string>;
  }): Parameters<typeof proxy>[0] {
    const headerEntries = new Headers(options.headers ?? {});
    return {
      nextUrl: {
        pathname: options.pathname,
        search: options.search ?? '',
        host: 'app.example',
        protocol: 'https:',
      },
      headers: headerEntries,
      cookies: { getAll: () => (options.cookies ?? []).map((name) => ({ name, value: 'x' })) },
    } as unknown as Parameters<typeof proxy>[0];
  }

  it('redirects a cookieless protected request to sign-in, before Next renders anything', () => {
    // Absence of the cookie is certainty, not a guess — no session can exist without it — so this
    // costs no network call. This is the half of SCR-07 that used to be missing entirely: a
    // signed-out browser stayed on /today behind a dismissible dialog.
    const response = proxy(request({ pathname: '/today' }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `https://app.example/sign-in?callbackURL=${encodeURIComponent('/today')}`,
    );
  });

  it('preserves the full return path, query included', () => {
    const response = proxy(request({ pathname: '/settings/athena', search: '?tab=mcp' }));

    expect(response.headers.get('location')).toBe(
      `https://app.example/sign-in?callbackURL=${encodeURIComponent('/settings/athena?tab=mcp')}`,
    );
  });

  it.each(['better-auth.session_token', '__Secure-better-auth.session_token'])(
    'lets %s through to the authoritative layout check',
    (cookieName) => {
      // Presence proves nothing — the token may be expired — so the middleware must NOT decide.
      const response = proxy(request({ pathname: '/today', cookies: [cookieName] }));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('tells the layout which path was requested, since Next exposes it no other way', () => {
    const response = proxy(
      request({
        pathname: '/calendar',
        search: '?day=2026-08-02',
        cookies: ['better-auth.session_token'],
      }),
    );

    expect(response.headers.get('x-middleware-request-x-docket-pathname')).toBe(
      '/calendar?day=2026-08-02',
    );
  });

  it('never gates the auth screens, so a stale cookie cannot ping-pong', () => {
    for (const pathname of ['/sign-in', '/sign-up', '/open', '/']) {
      const response = proxy(request({ pathname }));
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('still restores the browser-facing host for the proxied API paths', () => {
    const response = proxy(
      request({
        pathname: '/api/auth/get-session',
        headers: { 'x-forwarded-host': 'docket.example', host: '127.0.0.1:3000' },
      }),
    );

    expect(response.headers.get('x-middleware-request-host')).toBe('docket.example');
  });

  it('leaves an API request with a matching host untouched', () => {
    const response = proxy(
      request({
        pathname: '/v1/orgs',
        headers: { 'x-forwarded-host': 'docket.example', host: 'docket.example' },
      }),
    );

    expect(response.headers.get('x-middleware-request-host')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });
});
