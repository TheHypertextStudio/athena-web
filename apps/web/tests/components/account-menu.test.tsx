import '@testing-library/jest-dom/vitest';

import { ShellDrawerProvider } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const signOutAndPurge = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}));
vi.mock('../../src/lib/sign-out', () => ({
  signOutAndPurge,
  SignOutCleanupError: class SignOutCleanupError extends Error {},
}));

import AccountMenu from '../../src/components/account-menu';
import { AuthenticationInterlockProvider } from '../../src/components/authentication-interlock';
import { SignOutCleanupError } from '../../src/lib/sign-out';
import { makeQueryWrapper } from '../support/query';

const IDENTITY = {
  userId: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
} as const;

/**
 * Signing out now clears the persisted query cache as well as the session, so the menu reads the
 * query client from context and must be rendered inside a provider — as it always is in the app.
 */
function renderMenu(ui: React.ReactElement) {
  const { wrapper: Wrapper } = makeQueryWrapper();
  return render(
    <AuthenticationInterlockProvider>
      <Wrapper>{ui}</Wrapper>
    </AuthenticationInterlockProvider>,
  );
}

afterEach(() => {
  cleanup();
  signOutAndPurge.mockReset();
  signOutAndPurge.mockResolvedValue();
});

describe('AccountMenu', () => {
  it('opens the shared create-workspace action', async () => {
    const onCreateWorkspace = vi.fn();
    renderMenu(<AccountMenu identity={IDENTITY} onCreateWorkspace={onCreateWorkspace} />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create workspace' }));
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
  });

  it('dismisses the mobile navigation drawer when a menu action navigates away', async () => {
    // On mobile the account menu lives inside the off-canvas nav drawer (a Sheet). Selecting an
    // action navigates, but unless the drawer is dismissed the destination renders behind the
    // still-open drawer — reading as "nothing happened". The menu must close the drawer via the
    // shared dismiss context, the same mechanism the nav rows use.
    const onCreateWorkspace = vi.fn();
    const dismiss = vi.fn();
    renderMenu(
      <ShellDrawerProvider dismiss={dismiss}>
        <AccountMenu identity={IDENTITY} onCreateWorkspace={onCreateWorkspace} />
      </ShellDrawerProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create workspace' }));

    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('opens the user-owned global Settings destination', async () => {
    renderMenu(<AccountMenu identity={IDENTITY} onCreateWorkspace={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

    // The resolved destination, not the `/settings` hop. `/settings` only redirects server-side,
    // and a server redirect is not reliably observed across a client-side router transition —
    // which parked the menu on a Settings dialog with no section selected.
    expect(navigation.push).toHaveBeenCalledWith('/settings/profile');
  });

  it('shows a terminal recovery message when sign-out cannot clear local data', async () => {
    signOutAndPurge.mockRejectedValue(new Error('private browser failure'));
    renderMenu(<AccountMenu identity={IDENTITY} onCreateWorkspace={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign-out could not finish' })).toBeVisible();
    expect(screen.getByText(/could not confirm that your session ended/i)).toBeVisible();
    expect(screen.queryByText('private browser failure')).not.toBeInTheDocument();
  });

  it('shows the local cleanup recovery message when revoked data cannot be committed', async () => {
    signOutAndPurge.mockRejectedValue(new SignOutCleanupError());
    renderMenu(<AccountMenu identity={IDENTITY} onCreateWorkspace={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', { name: 'Sign-out could not finish safely' }),
    ).toBeVisible();
    expect(screen.getByText(/could not clear this browser's offline data/i)).toBeVisible();
  });
});
