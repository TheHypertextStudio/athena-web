import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateWithoutRouter, push, replace, routerReachable } = vi.hoisted(() => ({
  navigateWithoutRouter: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  routerReachable: { value: true },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock('../../src/components/reachability', () => ({
  useServerReachable: () => routerReachable.value,
}));

vi.mock('../../src/lib/offline-availability', () => ({
  useOfflineAvailability: () => 'available',
}));

vi.mock('../../src/lib/use-online-status', () => ({
  useOnlineStatus: () => routerReachable.value,
}));

vi.mock('../../src/lib/app-location', () => ({ navigateWithoutRouter }));

const { ResponsiveNavigationProvider, useResponsiveRouter } =
  await import('../../src/lib/interactions/navigation');
const DocketLink = (await import('../../src/components/docket-link')).default;

interface ProbeProps {
  readonly children?: ReactNode;
}

function NavigationProbe({ children }: ProbeProps): React.JSX.Element {
  const { requestedHref, push: navigate } = useResponsiveRouter();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          navigate('/projects');
        }}
      >
        Open projects
      </button>
      <output data-testid="requested">{requestedHref ?? 'settled'}</output>
      {children}
    </>
  );
}

function NavigationHarness({
  canonicalHref,
  children,
}: {
  readonly canonicalHref: string;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <ResponsiveNavigationProvider
      canonicalHref={canonicalHref}
      navigate={(href) => {
        push(href, undefined);
      }}
    >
      <NavigationProbe>{children}</NavigationProbe>
    </ResponsiveNavigationProvider>
  );
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  navigateWithoutRouter.mockReset();
  routerReachable.value = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('responsive navigation', () => {
  it('uses Next router transport when the app-location provider supplies no override', () => {
    render(
      <ResponsiveNavigationProvider canonicalHref="/today">
        <NavigationProbe />
      </ResponsiveNavigationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open projects' }));

    expect(push).toHaveBeenCalledWith('/projects', undefined);
  });

  it('publishes a requested destination while held navigation keeps the current content and focus', () => {
    const view = render(
      <NavigationHarness canonicalHref="/today">
        <label>
          Current draft <input defaultValue="Keep me" />
        </label>
        <main>Today content</main>
      </NavigationHarness>,
    );
    const input = screen.getByRole('textbox', { name: 'Current draft' });
    input.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Open projects' }));

    expect(screen.getByTestId('requested')).toHaveTextContent('/projects');
    expect(screen.getByRole('main')).toHaveTextContent('Today content');
    expect(input).toHaveFocus();
    expect(push).toHaveBeenCalledWith('/projects', undefined);

    view.rerender(
      <NavigationHarness canonicalHref="/projects">
        <main>Projects content</main>
      </NavigationHarness>,
    );

    expect(screen.getByTestId('requested')).toHaveTextContent('settled');
  });

  it('keeps only the latest rapid destination and clears an unsuccessful request', () => {
    function ReplacementProbe(): React.JSX.Element {
      const { requestedHref, push: navigate } = useResponsiveRouter();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              navigate('/projects');
            }}
          >
            Projects
          </button>
          <button
            type="button"
            onClick={() => {
              navigate('/tasks');
            }}
          >
            Tasks
          </button>
          <output data-testid="replacement">{requestedHref ?? 'settled'}</output>
        </>
      );
    }

    render(
      <ResponsiveNavigationProvider
        canonicalHref="/today"
        navigate={(href) => {
          push(href, undefined);
        }}
      >
        <ReplacementProbe />
      </ResponsiveNavigationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));

    expect(screen.getByTestId('replacement')).toHaveTextContent('/tasks');
    expect(push).toHaveBeenNthCalledWith(1, '/projects', undefined);
    expect(push).toHaveBeenNthCalledWith(2, '/tasks', undefined);

    push.mockImplementationOnce(() => {
      throw new Error('route unavailable');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

    expect(screen.getByTestId('replacement')).toHaveTextContent('settled');
  });

  it('abandons a pending destination when a different canonical route wins', () => {
    const view = render(
      <NavigationHarness canonicalHref="/today">
        <main>Today content</main>
      </NavigationHarness>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open projects' }));
    expect(screen.getByTestId('requested')).toHaveTextContent('/projects');

    view.rerender(
      <NavigationHarness canonicalHref="/calendar">
        <main>Calendar content</main>
      </NavigationHarness>,
    );

    expect(screen.getByTestId('requested')).toHaveTextContent('settled');
  });

  it('acknowledges online pointer and keyboard links without falsely declaring the destination current', () => {
    render(
      <ResponsiveNavigationProvider
        canonicalHref="/today"
        navigate={(href) => {
          push(href, undefined);
        }}
      >
        <DocketLink href="/projects" aria-current="page">
          Projects
        </DocketLink>
      </ResponsiveNavigationProvider>,
    );
    const link = screen.getByRole('link', { name: 'Projects' });

    fireEvent.click(link);

    expect(push).toHaveBeenCalledWith('/projects', undefined);
    expect(link).not.toHaveAttribute('aria-current');

    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.click(link, { detail: 0 });

    expect(push).toHaveBeenCalledTimes(2);
  });

  it('retains the existing offline history navigation path', async () => {
    routerReachable.value = false;
    render(
      <ResponsiveNavigationProvider canonicalHref="/today">
        <DocketLink href="/tasks">Tasks</DocketLink>
      </ResponsiveNavigationProvider>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

    expect(navigateWithoutRouter).toHaveBeenCalledWith('/tasks');
    expect(push).not.toHaveBeenCalled();
  });
});
