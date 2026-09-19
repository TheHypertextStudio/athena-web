import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateWithoutRouter, prefetchAuthenticatedRoute, responsiveRouter, serverReachable } =
  vi.hoisted(() => ({
    navigateWithoutRouter: vi.fn(),
    prefetchAuthenticatedRoute: vi.fn().mockResolvedValue(true),
    responsiveRouter: {
      current: null as null | {
        readonly requestedHref: string | null;
        readonly push: ReturnType<typeof vi.fn>;
        readonly replace: ReturnType<typeof vi.fn>;
      },
    },
    serverReachable: { value: true },
  }));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: ComponentProps<'a'> & { readonly prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../src/components/reachability', () => ({
  useServerReachable: () => serverReachable.value,
}));

vi.mock('../../src/lib/app-location', () => ({ navigateWithoutRouter }));
vi.mock('../../src/lib/interactions/navigation', () => ({
  useOptionalResponsiveRouter: () => responsiveRouter.current,
}));
vi.mock('../../src/lib/authenticated-route', () => ({
  parseAuthenticatedRoute: (pathname: string) => {
    if (pathname === '/orgs/org-1/projects/dependencies') {
      return {
        kind: 'matched',
        route: {
          params: { orgId: 'org-1' },
          pattern: '/orgs/[orgId]/projects/dependencies',
        },
      };
    }
    return {
      kind: 'matched',
      route:
        pathname === '/orgs/org-1/tasks/task-1'
          ? {
              params: { orgId: 'org-1', taskId: 'task-1' },
              pattern: '/orgs/[orgId]/tasks/[taskId]',
            }
          : { params: {}, pattern: '/tasks' },
    };
  },
  pathnameOf: (href: string) => href.split('?')[0],
  prefetchAuthenticatedRoute,
}));
vi.mock('../../src/lib/offline-availability', () => ({
  useOfflineAvailability: () => 'available',
}));

import DocketLink from '../../src/components/docket-link';

beforeEach(() => {
  navigateWithoutRouter.mockReset();
  prefetchAuthenticatedRoute.mockClear();
  serverReachable.value = true;
  responsiveRouter.current = null;
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DocketLink', () => {
  it('keeps an immediate offline click inside the running document', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    render(<DocketLink href="/tasks">Tasks</DocketLink>);

    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

    expect(navigateWithoutRouter).toHaveBeenCalledWith('/tasks');
  });

  it('prefetches only the client module after sustained navigation intent', async () => {
    vi.useFakeTimers();
    render(<DocketLink href="/tasks">Tasks</DocketLink>);
    const link = screen.getByRole('link', { name: 'Tasks' });

    fireEvent.mouseEnter(link);
    fireEvent.focus(link);

    expect(link).toHaveAttribute('data-prefetch', 'false');
    expect(prefetchAuthenticatedRoute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(75);
    expect(prefetchAuthenticatedRoute).toHaveBeenCalledTimes(1);
    expect(prefetchAuthenticatedRoute).toHaveBeenCalledWith('/tasks');
  });

  it('cancels a pending module prefetch when the person clicks immediately', () => {
    vi.useFakeTimers();
    render(<DocketLink href="/tasks">Tasks</DocketLink>);
    const link = screen.getByRole('link', { name: 'Tasks' });

    fireEvent.mouseEnter(link);
    fireEvent.click(link);
    vi.advanceTimersByTime(75);

    expect(prefetchAuthenticatedRoute).not.toHaveBeenCalled();
  });

  it('warms the Task aggregate after sustained navigation intent', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <DocketLink href="/orgs/org-1/tasks/task-1">Task</DocketLink>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Task' }));
    await vi.advanceTimersByTimeAsync(75);
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledWith(
      '/v1/orgs/org-1/tasks/task-1/aggregate-detail',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('warms the Project overview after sustained intent on the dependencies page', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <DocketLink href="/orgs/org-1/projects/dependencies">Dependencies</DocketLink>
      </QueryClientProvider>,
    );

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Dependencies' }));
    await vi.advanceTimersByTimeAsync(75);
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledWith(
      '/v1/orgs/org-1/projects/overview',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('hands the shared-element transition to the app navigation and keeps it off the anchor', () => {
    responsiveRouter.current = {
      requestedHref: null,
      push: vi.fn().mockReturnValue(true),
      replace: vi.fn().mockReturnValue(true),
    };
    render(
      <DocketLink href="/orgs/org-1/projects/dependencies" transition="shared-element">
        Dependencies
      </DocketLink>,
    );
    const link = screen.getByRole('link', { name: 'Dependencies' });

    fireEvent.click(link);

    expect(responsiveRouter.current.push).toHaveBeenCalledWith(
      '/orgs/org-1/projects/dependencies',
      {
        transition: 'shared-element',
      },
    );
    expect(link).not.toHaveAttribute('transition');
  });

  it('keeps the transition when the link also names its scroll behaviour', () => {
    responsiveRouter.current = {
      requestedHref: null,
      push: vi.fn().mockReturnValue(true),
      replace: vi.fn().mockReturnValue(true),
    };
    render(
      <DocketLink href="/tasks" scroll={false} transition="shared-element">
        Tasks
      </DocketLink>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

    expect(responsiveRouter.current.push).toHaveBeenCalledWith('/tasks', {
      scroll: false,
      transition: 'shared-element',
    });
  });

  it('requests no options for an ordinary link', () => {
    responsiveRouter.current = {
      requestedHref: null,
      push: vi.fn().mockReturnValue(true),
      replace: vi.fn().mockReturnValue(true),
    };
    render(<DocketLink href="/tasks">Tasks</DocketLink>);

    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

    expect(responsiveRouter.current.push).toHaveBeenCalledWith('/tasks', {});
  });

  it('warms a shared-element destination once the browser is idle, with no hover', async () => {
    vi.useFakeTimers();
    render(
      <DocketLink href="/orgs/org-1/projects/dependencies" transition="shared-element">
        Dependencies
      </DocketLink>,
    );
    expect(prefetchAuthenticatedRoute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(prefetchAuthenticatedRoute).toHaveBeenCalledTimes(1);
    expect(prefetchAuthenticatedRoute).toHaveBeenCalledWith('/orgs/org-1/projects/dependencies');
  });

  it('leaves an ordinary link cold until someone shows intent', async () => {
    vi.useFakeTimers();
    render(<DocketLink href="/tasks">Tasks</DocketLink>);

    await vi.advanceTimersByTimeAsync(500);

    expect(prefetchAuthenticatedRoute).not.toHaveBeenCalled();
  });
});
