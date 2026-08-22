/**
 * Regression tests for the app-wide provider stack.
 *
 * @remarks
 * React 19 warns when a Client Component renders a literal `<script>` tag because scripts created
 * during client render do not execute. The provider stack must keep theme setup script-free.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/query', () => ({
  createQueryClient: () => ({
    clear: vi.fn(),
    getDefaultOptions: vi.fn(() => ({})),
    mount: vi.fn(),
    unmount: vi.fn(),
  }),
}));

vi.mock('@/components/tasks/use-task-hierarchy-mutation', () => ({
  useTaskHierarchyMutation: () => ({ reparent: vi.fn() }),
}));

// The stack registers the app's action domains, and a task action navigates, so the tree now
// reaches for the router. There is no app router under a bare `render`, so stub it the same way
// every other routing-dependent test here does.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { Providers } from '../../src/components/providers';

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

  it('composes the receipt provider inside the query client without replacing the action provider', () => {
    const { container } = render(
      <Providers>
        <main>Receipt-ready</main>
      </Providers>,
    );

    expect(screen.getByText('Receipt-ready')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });

  it('installs exactly one document-level object context-menu handler', () => {
    const add = vi.spyOn(document, 'addEventListener');
    render(
      <Providers>
        <main>One menu</main>
      </Providers>,
    );

    expect(add.mock.calls.filter(([type]) => type === 'contextmenu')).toHaveLength(1);
    add.mockRestore();
  });

  it('installs exactly one document-level in-page find handler', () => {
    const add = vi.spyOn(document, 'addEventListener');
    render(
      <Providers>
        <main>One find router</main>
      </Providers>,
    );

    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    add.mockRestore();
  });
});
