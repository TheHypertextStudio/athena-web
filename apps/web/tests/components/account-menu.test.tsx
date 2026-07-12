import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
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
});
