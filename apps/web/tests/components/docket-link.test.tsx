import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateWithoutRouter, serverReachable } = vi.hoisted(() => ({
  navigateWithoutRouter: vi.fn(),
  serverReachable: { value: true },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../src/components/reachability', () => ({
  useServerReachable: () => serverReachable.value,
}));

vi.mock('../../src/lib/app-location', () => ({ navigateWithoutRouter }));
vi.mock('../../src/lib/offline-availability', () => ({
  useOfflineAvailability: () => 'available',
}));

import DocketLink from '../../src/components/docket-link';

beforeEach(() => {
  navigateWithoutRouter.mockReset();
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
});
