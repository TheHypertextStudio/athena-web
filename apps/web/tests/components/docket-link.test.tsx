import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateWithoutRouter, prefetchAuthenticatedRoute, serverReachable } = vi.hoisted(() => ({
  navigateWithoutRouter: vi.fn(),
  prefetchAuthenticatedRoute: vi.fn().mockResolvedValue(true),
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
vi.mock('../../src/lib/authenticated-route', () => ({
  parseAuthenticatedRoute: (pathname: string) => ({
    kind: 'matched',
    route:
      pathname === '/orgs/org-1/tasks/task-1'
        ? {
            params: { orgId: 'org-1', taskId: 'task-1' },
            pattern: '/orgs/[orgId]/tasks/[taskId]',
          }
        : { params: {}, pattern: '/tasks' },
  }),
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
});
