import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { completePost, linkSocial, useAppSearchParams } = vi.hoisted(() => ({
  completePost: vi.fn(),
  linkSocial: vi.fn(),
  useAppSearchParams: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        identities: {
          'external-agent-links': { $post: completePost },
        },
      },
    },
  },
}));
vi.mock('../../src/lib/auth-client', () => ({ authClient: { linkSocial } }));
vi.mock('../../src/lib/app-location', () => ({ useAppSearchParams }));
vi.mock('../../src/components/authentication-interlock', () => ({
  useOptionalAuthenticationRecovery: () => (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('../../src/components/docket-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ExternalAgentConnectPage from '../../src/app/(app)/external-agent/connect/page';

function wrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  completePost.mockReset();
  linkSocial.mockReset();
  useAppSearchParams.mockReset();
  useAppSearchParams.mockReturnValue(new URLSearchParams('token=signed-continuation'));
});

afterEach(cleanup);

describe('ExternalAgentConnectPage', () => {
  it('links Linear with write scope when the current identity does not match the continuation', async () => {
    completePost.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'Connect the account that opened this Athena session.',
          status: 409,
          code: 'external_identity_mismatch',
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    linkSocial.mockResolvedValue(undefined);

    render(<ExternalAgentConnectPage />, { wrapper: wrapper() });

    const button = await screen.findByRole('button', { name: 'Connect Linear account' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(linkSocial).toHaveBeenCalledWith({
        provider: 'linear',
        scopes: ['read', 'write'],
        callbackURL: '/external-agent/connect?token=signed-continuation',
      });
    });
  });

  it('confirms that Athena resumed after the exact linked identity consumes the continuation', async () => {
    completePost.mockResolvedValue(
      new Response(JSON.stringify({ status: true, sessionId: 'session-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<ExternalAgentConnectPage />, { wrapper: wrapper() });

    expect(
      await screen.findByRole('heading', { name: 'Athena is continuing in Linear' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Docket' })).toHaveAttribute('href', '/today');
    expect(linkSocial).not.toHaveBeenCalled();
  });

  it('does not call the API when the signed continuation is missing', () => {
    useAppSearchParams.mockReturnValue(new URLSearchParams());

    render(<ExternalAgentConnectPage />, { wrapper: wrapper() });

    expect(screen.getByRole('heading', { name: 'This link is invalid' })).toBeInTheDocument();
    expect(completePost).not.toHaveBeenCalled();
  });
});
