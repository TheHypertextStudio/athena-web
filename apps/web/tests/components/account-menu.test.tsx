import '@testing-library/jest-dom/vitest';

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
