import '@testing-library/jest-dom/vitest';

import { ContextProvider } from '@docket/ui/components';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ path: '/plan', search: 'view=day' }));
vi.mock('../../src/lib/app-location', () => ({
  useAppPathname: () => location.path,
  useAppSearchParams: () => new URLSearchParams(location.search),
}));
import { NavigationShell } from '../../src/components/navigation-shell';

afterEach(cleanup);

function renderNavigation() {
  return render(
    <ContextProvider>
      <NavigationShell sidebar={<nav aria-label="Application">Tasks and projects</nav>}>
        <h1>Current activity</h1>
      </NavigationShell>
    </ContextProvider>,
  );
}

describe('planning navigation context', () => {
  it('omits application navigation only during daily planning and restores it on exit', () => {
    location.path = '/plan';
    location.search = 'view=day&date=2026-10-07';
    const view = renderNavigation();
    expect(screen.queryByRole('navigation', { name: 'Application' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading'));
    view.unmount();
    location.path = '/today';
    location.search = '';
    renderNavigation();
    expect(screen.getByRole('navigation', { name: 'Application' })).toBeInTheDocument();
  });

  it('retains the application context for weekly planning', () => {
    location.path = '/plan';
    location.search = '';
    renderNavigation();
    expect(screen.getByRole('navigation', { name: 'Application' })).toBeInTheDocument();
  });
});
