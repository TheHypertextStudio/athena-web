import '@testing-library/jest-dom/vitest';

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
  parseAuthenticatedRoute: () => ({ kind: 'matched' }),
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

afterEach(cleanup);

describe('DocketLink', () => {
  it('keeps an immediate offline click inside the running document', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    render(<DocketLink href="/tasks">Tasks</DocketLink>);

    fireEvent.click(screen.getByRole('link', { name: 'Tasks' }));

    expect(navigateWithoutRouter).toHaveBeenCalledWith('/tasks');
  });

  it('prefetches only the client module after explicit navigation intent', () => {
    render(<DocketLink href="/tasks">Tasks</DocketLink>);
    const link = screen.getByRole('link', { name: 'Tasks' });

    fireEvent.mouseEnter(link);
    fireEvent.focus(link);

    expect(link).toHaveAttribute('data-prefetch', 'false');
    expect(prefetchAuthenticatedRoute).toHaveBeenCalledTimes(2);
    expect(prefetchAuthenticatedRoute).toHaveBeenCalledWith('/tasks');
  });
});
