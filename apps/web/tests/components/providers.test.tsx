/**
 * Regression tests for the app-wide provider stack.
 *
 * @remarks
 * React 19 warns when a Client Component renders a literal `<script>` tag because scripts created
 * during client render do not execute. The provider stack must keep theme setup script-free.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/query', () => ({
  createQueryClient: () => ({
    clear: vi.fn(),
    getDefaultOptions: vi.fn(() => ({})),
    mount: vi.fn(),
    unmount: vi.fn(),
  }),
}));

import { Providers } from '../../src/components/providers';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      matches: false,
      media: '(prefers-color-scheme: dark)',
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
});

afterEach(cleanup);

describe('Providers', () => {
  it('does not render script tags from client providers', () => {
    const { container } = render(
      <Providers>
        <main>Loaded</main>
      </Providers>,
    );

    expect(screen.getByText('Loaded')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });
});
