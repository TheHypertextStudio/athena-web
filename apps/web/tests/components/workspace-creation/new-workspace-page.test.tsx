import '@testing-library/jest-dom/vitest';

import { ContextProvider } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { back, replace, createWorkspace } = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  createWorkspace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back, replace }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user_1' } } }),
  },
}));

vi.mock('../../../src/lib/workspace-creation', () => ({ createWorkspace }));

import NewWorkspacePage from '../../../src/app/(app)/workspaces/new/page';

/** Render the page with the same context/query providers it receives from the app shell. */
function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ContextProvider initialContext="old_org">
        <NewWorkspacePage />
      </ContextProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  back.mockReset();
  replace.mockReset();
  createWorkspace.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('NewWorkspacePage', () => {
  it('creates a trimmed shared workspace with standard terminology and opens My Work', async () => {
    createWorkspace.mockResolvedValue({
      organization: { id: 'new_org', name: 'Acme' },
      defaultTeam: { id: 'team_1', name: 'General', key: 'GEN' },
      ownerActorId: 'actor_1',
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Workspace name'), {
      target: { value: '  Acme  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith({
        name: 'Acme',
        isPersonal: false,
        vocabulary: 'startup',
      });
    });
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/orgs/new_org/my-work');
    });
    expect(window.localStorage.getItem('docket:last-org:user_1')).toBe('new_org');
  });

  it('keeps the entered name and surfaces an API failure for retry', async () => {
    createWorkspace.mockRejectedValue(new Error('Workspace limit reached.'));
    renderPage();

    const input = screen.getByLabelText('Workspace name');
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace limit reached.');
    expect(input).toHaveValue('Acme');
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps blank names disabled and cancels back to the prior surface', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
