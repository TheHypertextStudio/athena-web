import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orgsGet, pathnameState, requireAuthentication, resolveTabTitle, sessionState } = vi.hoisted(
  () => ({
    orgsGet: vi.fn(),
    pathnameState: { value: '/today' },
    requireAuthentication: vi.fn(),
    resolveTabTitle: vi.fn(() => Promise.resolve('Project Atlas')),
    // Mirrors Better Auth's `useSession` return shape. `error` is what separates "the server said
    // there is no session" (200 with a null body) from "the server could not be reached" — the
    // shell branches on that difference, so the mock has to carry it.
    sessionState: {
      data: null as null | { user: { id: string; name: string; email: string } },
      isPending: true,
      error: null as null | { status: number },
      refetch: vi.fn(),
    },
  }),
);

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
  signOut: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        $get: orgsGet,
      },
    },
  },
}));

vi.mock('../../src/components/authentication-interlock', () => ({
  useAuthenticationInterlock: () => ({ requireAuthentication }),
  useOptionalAuthenticationRecovery:
    () =>
    async <T,>(action: () => Promise<T>) =>
      action(),
}));

vi.mock('../../src/components/tabs/resolve-title', () => ({
  fallbackTitle: () => 'Project',
  resolveTabTitle,
}));

import { AppShellFrame } from '../../src/components/app-shell-frame';
import type { ServerSessionUser } from '../../src/lib/server-session';

/** A server-confirmed identity, as the `(app)` layout resolves it before the document is sent. */
const SERVER_SESSION: ServerSessionUser = {
  userId: 'user_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  image: null,
};

/**
 * Render the frame with the same query boundary supplied by the root app providers.
 *
 * @param initialSession - The server-confirmed identity, or `null` for a server read of `'unknown'`.
 */
function renderFrame(initialSession: ServerSessionUser | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const frame = () => (
    <QueryClientProvider client={queryClient}>
      <AppShellFrame initialSession={initialSession}>
        <div>Private route content</div>
      </AppShellFrame>
    </QueryClientProvider>
  );
  const rendered = render(frame());
  return {
    ...rendered,
    rerenderFrame: () => {
      rendered.rerender(frame());
    },
  };
}

/** Every animated placeholder currently on screen, scoped to a container. */
function placeholdersIn(container: HTMLElement): readonly Element[] {
  return Array.from(container.querySelectorAll('.animate-pulse, [data-slot="skeleton"]'));
}

beforeEach(() => {
  sessionState.data = null;
  sessionState.isPending = true;
  sessionState.error = null;
  sessionState.refetch.mockReset();
  window.localStorage.clear();
  // These tests are about what a *fetch* may withhold, and the answer is "no nav label, ever".
  // The sidebar also collapses its labels into tooltips below 1440px, and jsdom reports a 1024px
  // window — so without pinning it expanded the assertions below would be measuring the width
  // default rather than the loading behaviour they exist to protect.
  window.localStorage.setItem('docket.sidebar.collapsed', '0');
  pathnameState.value = '/today';
  orgsGet.mockReset().mockImplementation(() => new Promise(() => undefined));
  requireAuthentication.mockReset();
  resolveTabTitle.mockReset().mockResolvedValue('Project Atlas');
  window.history.replaceState({}, '', '/today?view=week');
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

describe('AppShellFrame session loading', () => {
  it('paints the page and every statically-known nav label the moment the server names the viewer', () => {
    renderFrame(SERVER_SESSION);

    // The whole point of the server-confirmed identity: nothing here waits on a fetch. The page's
    // own content, the Home rows and the Workspace rows are all on screen at first paint.
    expect(screen.getByText('Private route content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    for (const label of ['My Work', 'Triage', 'Initiatives', 'Programs', 'Projects', 'Cycles']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The main-panel loading wall is gone, not merely hidden.
    expect(
      screen.queryByRole('status', { name: 'Loading your workspace' }),
    ).not.toBeInTheDocument();
    // Identity is known, so the account area is real rather than a placeholder.
    expect(placeholdersIn(screen.getByRole('main'))).toHaveLength(0);
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('renders every workspace label as inert text, never as a grey bar, before a workspace resolves', () => {
    renderFrame(SERVER_SESSION);

    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    // No org has resolved yet, so the rows cannot be links — but their labels are compile-time
    // constants, so they are still the rows' content.
    expect(placeholdersIn(workspaceNav)).toHaveLength(0);
    expect(workspaceNav.querySelectorAll('a')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Projects' })).toBeDisabled();
  });

  it('keeps the shell and the page visible while the session resolves with no server identity', () => {
    renderFrame(null);

    // `initialSession: null` means the server could not ask — which is not a reason to withhold
    // the page. Only the identity-bound and workspace-bound regions may show a loading treatment.
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Private route content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Loading your workspace' }),
    ).not.toBeInTheDocument();
    expect(placeholdersIn(screen.getByRole('main'))).toHaveLength(0);
    expect(placeholdersIn(screen.getByRole('navigation', { name: 'Workspace' }))).toHaveLength(0);

    // The two regions that legitimately do not know their content yet.
    const sidebar = screen.getByRole('complementary', { name: 'Navigation' });
    expect(screen.getByRole('button', { name: /Loading workspaces/i })).toBeDisabled();
    expect(within(sidebar).getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(placeholdersIn(sidebar).length).toBeGreaterThan(0);
    // The mobile search control needs no data at all, so it is a real button, not a grey square.
    expect(screen.getAllByRole('button', { name: 'Search' }).length).toBeGreaterThan(1);
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('renders open document tabs without waiting for the organization list', async () => {
    pathnameState.value = '/orgs/01HZX5K3QJ9F8B7C6D5E4F3G2H/projects/01HZX5K3QJ9F8B7C6D5E4F3G2J';

    renderFrame(SERVER_SESSION);

    // `orgsGet` is still pending (the default mock never settles). The tab bar is chrome, so it
    // must not be withheld behind that fetch.
    expect(await screen.findByText('Project Atlas')).toBeInTheDocument();
  });

  it('keeps the shell visible while opening the sign-in interlock for a resolved missing session', async () => {
    sessionState.isPending = false;

    renderFrame();

    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByText('Private route content')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(requireAuthentication).toHaveBeenCalledWith('/today?view=week');
    });
  });

  it('never demands a sign-in when the session request failed rather than answering', async () => {
    // The regression this branch exists to prevent. Offline — or against a 5xx — the session query
    // rejects, which used to look identical to "no session" and threw up the non-dismissible
    // sign-in interlock at someone whose session was perfectly valid and who could not possibly
    // have signed in on that network.
    sessionState.isPending = false;
    sessionState.error = { status: 0 };

    renderFrame();

    await waitFor(() => {
      expect(screen.getByText(/You're offline|Can't reach Docket/)).toBeInTheDocument();
    });
    expect(requireAuthentication).not.toHaveBeenCalled();
    // The chrome must survive: an unreachable server degrades the content region, never the app.
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
  });

  it('degrades only the content region when there is no cached identity', async () => {
    sessionState.isPending = false;
    sessionState.error = { status: 0 };

    renderFrame();

    // No snapshot, so there is no workspace to populate — but that is not a reason to replace the
    // application with an error page. An earlier version rendered a full-screen wall here, which
    // threw away navigation, settings and the command palette along with the session lookup.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    // Still no private content and still no sign-in demand: unknown is not signed-out.
    expect(screen.queryByText('Private route content')).not.toBeInTheDocument();
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('clears the cached identity when the server confirms the session is gone', async () => {
    window.localStorage.setItem(
      'docket:session-snapshot',
      JSON.stringify({
        userId: 'user_1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        image: null,
        savedAt: Date.now(),
      }),
    );
    sessionState.isPending = false;
    sessionState.error = null;

    renderFrame();

    // "Signed out, then offline" must never render a shell, so the snapshot goes before the
    // redirect rather than lingering for the next unreachable launch to pick up.
    await waitFor(() => {
      expect(requireAuthentication).toHaveBeenCalled();
    });
    expect(window.localStorage.getItem('docket:session-snapshot')).toBeNull();
  });

  it('renders the page while organizations resolve, gating only the workspace switcher', () => {
    sessionState.data = {
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    };
    sessionState.isPending = false;

    renderFrame();

    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    // The workspace switcher genuinely does not know the workspace's name yet.
    expect(screen.getByRole('button', { name: /Loading workspaces/i })).toBeDisabled();
    // Everything that is already known renders: the page, and the Workspace labels. A settled
    // "no workspace" empty state would be a lie while the list is still in flight, so it stays out.
    expect(screen.getByText('Private route content')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.queryByText('No workspace yet')).not.toBeInTheDocument();
    expect(requireAuthentication).not.toHaveBeenCalled();
  });

  it('preserves the shared shell instance when session and organization context resolve', async () => {
    let resolveOrganizations: ((response: Response) => void) | undefined;
    orgsGet.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveOrganizations = resolve;
        }),
    );
    const { rerenderFrame } = renderFrame();
    const loadingMain = screen.getByRole('main');

    sessionState.data = {
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    };
    sessionState.isPending = false;
    rerenderFrame();

    await waitFor(() => {
      expect(orgsGet).toHaveBeenCalledOnce();
    });
    await act(async () => {
      resolveOrganizations?.(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    expect(await screen.findByText('Private route content')).toBeVisible();
    expect(screen.getByRole('main')).toBe(loadingMain);
  });

  it('does not resolve protected document tabs before the session exists', async () => {
    pathnameState.value = '/orgs/01HZX5K3QJ9F8B7C6D5E4F3G2H/projects/01HZX5K3QJ9F8B7C6D5E4F3G2J';

    renderFrame();

    await act(async () => Promise.resolve());
    expect(resolveTabTitle).not.toHaveBeenCalled();
  });

  it('keeps the global command shortcut inert until authenticated context resolves', () => {
    renderFrame();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('scopes document title resolution to the authenticated user', async () => {
    pathnameState.value = '/orgs/01HZX5K3QJ9F8B7C6D5E4F3G2H/projects/01HZX5K3QJ9F8B7C6D5E4F3G2J';
    sessionState.data = {
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    };
    sessionState.isPending = false;
    orgsGet.mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    let resolveFirstTitle: ((title: string) => void) | undefined;
    let resolveSecondTitle: ((title: string) => void) | undefined;
    resolveTabTitle
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirstTitle = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSecondTitle = resolve;
          }),
      );
    const { rerenderFrame } = renderFrame();
    await waitFor(() => {
      expect(resolveTabTitle).toHaveBeenCalledOnce();
    });

    sessionState.data = {
      user: { id: 'user_2', name: 'Grace Hopper', email: 'grace@example.com' },
    };
    rerenderFrame();

    await waitFor(() => {
      expect(resolveTabTitle).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      resolveFirstTitle?.('Ada project');
    });
    expect(screen.queryByText('Ada project')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecondTitle?.('Grace project');
    });
    expect(await screen.findByText('Grace project')).toBeVisible();
  });
});
