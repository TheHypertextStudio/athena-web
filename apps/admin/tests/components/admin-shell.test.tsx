// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // Annotated rather than asserted: the queue depths widen to "a number or not yet known", which
  // is the distinction the badge tests turn on.
  const queues: { discountReviews: number | undefined; pendingDeletion: number | undefined } = {
    discountReviews: undefined,
    pendingDeletion: undefined,
  };
  return {
    push: vi.fn(),
    replace: vi.fn(),
    signOut: vi.fn<(expectedUserId: string) => Promise<void>>(),
    pathname: '/',
    queues,
  };
});

// Spreads every prop it is handed, which is what the real `next/link` does. A mock that
// cherry-picks `href` silently drops the props `SidebarNavItem` merges onto its `asChild` link —
// `aria-current`, `aria-label`, `className` — and would make the active-route assertions below
// pass or fail for reasons that have nothing to do with the component under test.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    readonly children: ReactNode;
    readonly href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/components/viewing-as-banner', () => ({ ViewingAsBanner: () => null }));

// The queue badges and the operator tier are their own reads with their own tests. Stubbing them
// keeps this file about the shell and keeps it renderable without a query client.
vi.mock('@/lib/use-admin-queues', () => ({ useAdminQueues: () => mocks.queues }));

vi.mock('@/lib/use-operator', () => ({
  useOperator: () => ({
    tier: 'superadmin',
    tierLabel: 'Superadmin',
    atLeast: () => true,
    loading: false,
  }),
}));

vi.mock('@/lib/auth-client', () => ({
  signOut: mocks.signOut,
  useSession: () => ({
    data: { user: { id: 'operator-1', email: 'operator@example.com' } },
    isPending: false,
  }),
}));

import { AdminShell } from '@/components/admin-shell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** The accessible name of a control, however the row chose to carry it. */
function accessibleName(element: Element): string {
  return element.getAttribute('aria-label') ?? element.textContent;
}

/** The sign-out control, found by accessible name so a collapsed rail still resolves it. */
function findSignOut(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    accessibleName(candidate).startsWith('Sign out'),
  );
  if (!button) throw new Error('Expected the shell to render a sign-out control.');
  return button;
}

describe('AdminShell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/';
    mocks.queues = { discountReviews: undefined, pendingDeletion: undefined };
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

  /** Render the shell and settle its effects. */
  async function render(): Promise<void> {
    await act(async () => {
      root.render(<AdminShell>Admin content</AdminShell>);
    });
  }

  describe('navigation', () => {
    it('reaches every operator screen, including service status and the retention board', async () => {
      await render();
      const hrefs = Array.from(container.querySelectorAll('nav a')).map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toEqual([
        '/',
        '/users',
        '/orgs',
        '/discounts',
        '/notifications',
        '/status',
        '/athena',
        '/audit',
        '/lifecycle',
        '/operators',
        '/settings',
      ]);
    });

    it('groups destinations into labelled sections', async () => {
      await render();
      const sections = Array.from(container.querySelectorAll('nav')).map((nav) =>
        nav.getAttribute('aria-label'),
      );
      expect(sections).toEqual(['Overview', 'Accounts', 'Revenue', 'Operations', 'Service']);
    });

    it('marks only the current route as the active page', async () => {
      mocks.pathname = '/orgs';
      await render();
      const current = Array.from(container.querySelectorAll('nav a'))
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.getAttribute('href'));
      expect(current).toEqual(['/orgs']);
    });

    it('keeps a detail route within its section', async () => {
      mocks.pathname = '/orgs/org-123';
      await render();
      const current = Array.from(container.querySelectorAll('nav a'))
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.getAttribute('href'));
      expect(current).toEqual(['/orgs']);
    });

    it('folds a queue depth into the entry name so it is announced, not just drawn', async () => {
      mocks.queues = { discountReviews: 3, pendingDeletion: 2 };
      await render();
      const discounts = Array.from(container.querySelectorAll('nav a')).find(
        (a) => a.getAttribute('href') === '/discounts',
      );
      expect(discounts?.getAttribute('aria-label')).toBe('Discounts, 3 awaiting review');
    });

    it('badges nothing while a queue depth is unknown', async () => {
      await render();
      const discounts = Array.from(container.querySelectorAll('nav a')).find(
        (a) => a.getAttribute('href') === '/discounts',
      );
      // An unread queue must not render as "0" — "nothing waiting" and "we could not find out"
      // are different facts, and an operator must never read the second as the first.
      expect(discounts?.getAttribute('aria-label')).not.toContain('0');
    });
  });

  describe('sign-out', () => {
    it('shows owned failure copy and restores the control when sign-out fails', async () => {
      mocks.signOut.mockRejectedValue(new Error('provider detail that must stay private'));
      await render();

      await act(async () => {
        findSignOut(container).click();
        await Promise.resolve();
      });

      // Asserted as structure, not wording: a status region must appear carrying application
      // copy rather than the provider's exception text. It lives in the shell's banner slot rather
      // than the sidebar so a collapsed rail cannot hide it.
      const banner = container.querySelector('[role="status"], [role="alert"]');
      if (!banner) throw new Error('Expected the shell to surface the failure in its banner.');
      expect(banner.textContent.trim()).toBeTruthy();
      expect(container.textContent).not.toContain('provider detail that must stay private');
      expect(mocks.push).not.toHaveBeenCalled();
      expect(findSignOut(container).disabled).toBe(false);
    });

    it('returns to sign-in when sign-out succeeds', async () => {
      mocks.signOut.mockResolvedValue();
      await render();

      await act(async () => {
        findSignOut(container).click();
        await Promise.resolve();
      });

      expect(mocks.signOut).toHaveBeenCalledWith('operator-1');
      expect(mocks.push).toHaveBeenCalledWith('/sign-in');
      expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
    });
  });
});
