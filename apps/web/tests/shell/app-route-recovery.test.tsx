import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'org_123';

/** The error Next's redirect helper throws to short-circuit the page render. */
class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super('redirect');
  }
}

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock('next/navigation', () => ({ redirect: redirectMock }));

vi.mock('@/lib/app-location', () => ({
  useTypedRoute: () => ({ params: { orgId: ORG_ID } }),
}));

vi.mock('next/link', () => ({
  default: function LinkStub({
    href,
    children,
    ...props
  }: {
    readonly href: string;
    readonly children: React.ReactNode;
  }): React.JSX.Element {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

const AppRouteError = (await import('@/app/(app)/error')).default;
const AppRouteNotFound = (await import('@/app/(app)/not-found')).default;
const GlobalError = (await import('@/app/global-error')).default;
const OrgNotFoundPage = (await import('@/app/(app)/orgs/[orgId]/[...unmatched]/page')).default;
const OrgLandingPage = (await import('@/app/(app)/orgs/[orgId]/page')).default;

beforeEach(() => {
  redirectMock.mockReset();
  redirectMock.mockImplementation((destination: string): never => {
    throw new RedirectSignal(destination);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('authenticated route recovery', () => {
  it('keeps an unexpected page failure in the shell content region with generic copy and recovery actions', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const error = new Error('Database credentials: never expose this error');

    render(<AppRouteError error={error} reset={reset} />);

    const region = screen.getByRole('region', { name: 'Couldn’t load this page' });
    expect(region).toHaveClass('h-full');
    expect(region).not.toHaveClass('min-h-dvh');
    expect(region.querySelector('main')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Couldn’t load this page' })).toBeVisible();
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today');
  });

  it('renders explicit app not-found states in the same shell content region', () => {
    render(<AppRouteNotFound />);

    const region = screen.getByRole('region', { name: 'This page doesn’t exist' });
    expect(region).toHaveClass('h-full');
    expect(region).not.toHaveClass('min-h-dvh');
    expect(screen.getByRole('heading', { name: 'This page doesn’t exist' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today');
  });

  it('replaces a root failure with application-owned retry and recovery actions', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const error = new Error('never show this provider detail');

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Couldn’t load Docket' })).toBeVisible();
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today');
  });

  it('keeps unmatched workspace routes in the shell and returns to that workspace', () => {
    render(<OrgNotFoundPage />);

    expect(screen.getByRole('heading', { name: 'This page doesn’t exist' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to My Work' })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/my-work`,
    );
  });

  it('redirects the exact workspace root to My Work before it can fall through to a root 404', async () => {
    await expect(
      OrgLandingPage({ params: Promise.resolve({ orgId: ORG_ID }) }),
    ).rejects.toMatchObject({ destination: `/orgs/${ORG_ID}/my-work` });
  });
});
