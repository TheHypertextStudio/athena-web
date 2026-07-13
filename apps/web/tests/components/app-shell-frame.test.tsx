import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { orgsGet, requireAuthentication, sessionState } = vi.hoisted(() => ({
  orgsGet: vi.fn(),
  requireAuthentication: vi.fn(),
  sessionState: {
    data: null as null | { user: { id: string; name: string; email: string } },
    isPending: true,
  },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
  useRouter: () => ({ push: vi.fn() }),
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
}));

import { AppShellFrame } from '../../src/components/app-shell-frame';

/** Render the frame with the same query boundary supplied by the root app providers. */
function renderFrame() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const frame = () => (
    <QueryClientProvider client={queryClient}>
      <AppShellFrame>
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

beforeEach(() => {
  sessionState.data = null;
  sessionState.isPending = true;
  orgsGet.mockReset().mockImplementation(() => new Promise(() => undefined));
  requireAuthentication.mockReset();
  window.history.replaceState({}, '', '/today?view=week');
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
  vi.unstubAllGlobals();
});

describe('AppShellFrame session loading', () => {
  it('keeps the shell and Home navigation visible while the session resolves', () => {
    renderFrame();

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Loading workspaces/i })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading your workspace' })).toBeInTheDocument();
    expect(screen.queryByText('Private route content')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading your workspace…')).not.toBeInTheDocument();
    expect(requireAuthentication).not.toHaveBeenCalled();
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

  it('keeps workspace-bound content provisional while organizations resolve', () => {
    sessionState.data = {
      user: { id: 'user_1', name: 'Ada Lovelace', email: 'ada@example.com' },
    };
    sessionState.isPending = false;

    renderFrame();

    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Loading workspaces/i })).toBeDisabled();
    expect(screen.queryByText('Private route content')).not.toBeInTheDocument();
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
});
