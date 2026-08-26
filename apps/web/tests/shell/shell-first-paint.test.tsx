/**
 * The first-paint regression lock for the app shell: nothing statically known — the shell chrome,
 * the page heading, the tab bar — may wait on a fetch or hide behind a placeholder or a
 * full-viewport loader.
 *
 * @remarks
 * Renders {@link AppShellFrame} in the hardest honest case — a server-confirmed identity, every
 * client query left pending forever — and asserts that the only animated placeholders on screen
 * stand for data that genuinely cannot be known yet.
 *
 * This encodes a measured regression. Before the flag split, a cold authenticated entry to `/today`
 * showed 15 pulsing placeholders and no `h1` for the first ~420ms, because one `shellLoading` flag
 * gated the page's own children, the tab bar, the mobile search control and the entire Workspace
 * nav on a session lookup plus an org fetch. Every label behind those placeholders was a
 * compile-time constant. A test that merely counts placeholders would drift, so this one asserts
 * *where* they are allowed to be: nowhere except the workspace switcher's name.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orgsGet, pathnameState, requireAuthentication, sessionState } = vi.hoisted(() => ({
  orgsGet: vi.fn(),
  pathnameState: { value: '/today' },
  requireAuthentication: vi.fn(),
  sessionState: {
    data: null as null | { user: { id: string; name: string; email: string } },
    isPending: true,
    error: null as null | { status: number },
    refetch: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// The URL is read through the app's own location source rather than Next's router, so that is what
// a test presents. See `src/lib/app-location.tsx`.
vi.mock('../../src/lib/app-location', () => ({
  useAppPathname: () => pathnameState.value,
  useAppSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('../../src/lib/auth-client', () => ({
  authClient: { useSession: () => sessionState },
  useSession: () => sessionState,
  signOut: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { orgs: { $get: orgsGet } } },
}));

vi.mock('../../src/components/authentication-interlock', () => ({
  useAuthenticationInterlock: () => ({ requireAuthentication }),
  useOptionalAuthenticationRecovery:
    () =>
    async <T,>(action: () => Promise<T>) =>
      action(),
}));

import { AppShellFrame } from '../../src/components/app-shell-frame';
import type { ServerSessionUser } from '../../src/lib/server-session';

/** The identity the `(app)` layout resolves server-side before the document is sent. */
const SERVER_SESSION: ServerSessionUser = {
  userId: 'user_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: null,
};

/** Every animated placeholder inside a container. */
function placeholdersIn(container: Element): readonly Element[] {
  return Array.from(container.querySelectorAll('.animate-pulse, [data-slot="skeleton"]'));
}

/** Render the shell with a server-confirmed identity and no query that will ever settle. */
function renderFirstPaint(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AppShellFrame initialSession={SERVER_SESSION}>
        {/* Stands in for a real page: a statically-known heading it can paint with no data. */}
        <div>
          <h1>Today</h1>
        </div>
      </AppShellFrame>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionState.data = null;
  sessionState.isPending = true;
  sessionState.error = null;
  sessionState.refetch.mockReset();
  window.localStorage.clear();
  // This suite protects fetch-independent sidebar labels and the one permitted workspace skeleton.
  // jsdom reports a 1024px viewport, which selects the rail for a first-time viewer. Pin the full
  // sidebar so the test stays about loading behavior; the rail has its own labeled-loading tests.
  window.localStorage.setItem('docket.sidebar.collapsed', '0');
  pathnameState.value = '/today';
  // Never settles: the shell must be fully usable before any of this arrives.
  orgsGet.mockReset().mockImplementation(() => new Promise(() => undefined));
  requireAuthentication.mockReset();
  window.history.replaceState({}, '', '/today');
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
});

describe('app shell first paint', () => {
  it('paints the page heading with every query still in flight', () => {
    renderFirstPaint();

    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
  });

  it('renders no placeholder in the main content region', () => {
    renderFirstPaint();

    expect(placeholdersIn(screen.getByRole('main'))).toHaveLength(0);
    expect(
      screen.queryByRole('status', { name: 'Loading your workspace' }),
    ).not.toBeInTheDocument();
  });

  it('renders no placeholder in the sidebar Workspace section', () => {
    renderFirstPaint();

    expect(placeholdersIn(screen.getByRole('navigation', { name: 'Workspace' }))).toHaveLength(0);
  });

  it('renders no placeholder in the Home navigation section', () => {
    renderFirstPaint();

    expect(placeholdersIn(screen.getByRole('navigation', { name: 'Home' }))).toHaveLength(0);
  });

  it('confines every remaining placeholder to the workspace switcher', () => {
    renderFirstPaint();

    // The one honestly-unknown value in the shell chrome: which workspace this is. Everything else
    // is a compile-time constant or derived from the route.
    const switcher = screen.getByRole('button', { name: /Loading workspaces/i });
    const remaining = placeholdersIn(document.body);
    expect(remaining.length).toBeGreaterThan(0);
    for (const node of remaining) expect(switcher.contains(node)).toBe(true);
  });

  it('renders the mobile search control rather than a placeholder in its place', () => {
    renderFirstPaint();

    const searchControls = screen.getAllByRole('button', { name: 'Search' });
    // The sidebar row plus the mobile header action; neither needs data to work.
    expect(searchControls.length).toBeGreaterThan(1);
    for (const control of searchControls) expect(placeholdersIn(control)).toHaveLength(0);
  });
});
