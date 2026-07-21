import '@testing-library/jest-dom/vitest';

import { ShellDrawerProvider } from '@docket/ui/components';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}));

vi.mock('../../src/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } } }),
  },
  signOut: vi.fn(),
}));

import AccountMenu from '../../src/components/account-menu';

afterEach(() => {
  cleanup();
});

describe('AccountMenu', () => {
  it('opens the shared create-workspace action', async () => {
    const onCreateWorkspace = vi.fn();
    render(<AccountMenu onCreateWorkspace={onCreateWorkspace} />);

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
    render(
      <ShellDrawerProvider dismiss={dismiss}>
        <AccountMenu onCreateWorkspace={onCreateWorkspace} />
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
    render(<AccountMenu onCreateWorkspace={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Account menu' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

    expect(navigation.push).toHaveBeenCalledWith('/settings');
  });
});
