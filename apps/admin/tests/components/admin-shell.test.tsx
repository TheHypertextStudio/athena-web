// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  signOut: vi.fn<(expectedUserId: string) => Promise<void>>(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { readonly children: ReactNode; readonly href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/components/viewing-as-banner', () => ({ ViewingAsBanner: () => null }));

vi.mock('@/lib/auth-client', () => ({
  signOut: mocks.signOut,
  useSession: () => ({
    data: {
      user: {
        id: 'operator-1',
        email: 'operator@example.com',
      },
    },
    isPending: false,
  }),
}));

import { AdminShell } from '@/components/admin-shell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('AdminShell sign-out', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows owned failure copy and restores sign-out controls when sign-out fails', async () => {
    mocks.signOut.mockRejectedValue(new Error('provider detail that must stay private'));
    await act(async () => {
      root.render(<AdminShell>Admin content</AdminShell>);
    });

    const firstSignOut = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Sign out',
    );
    if (!firstSignOut) throw new Error('Expected the shell to render a sign-out control.');

    await act(async () => {
      firstSignOut.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not sign out. Check your connection and try again.',
    );
    expect(container.textContent).not.toContain('provider detail that must stay private');
    expect(mocks.push).not.toHaveBeenCalled();
    for (const button of container.querySelectorAll('button')) {
      if (button.textContent === 'Sign out') expect(button.disabled).toBe(false);
    }
  });
});
