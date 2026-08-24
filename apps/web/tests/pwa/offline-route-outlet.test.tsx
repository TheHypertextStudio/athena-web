import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/projects/01ARZ3NDEKTSV4RRFFQ69G5FAW';
let navigationSnapshot: {
  readonly target: 'task';
  readonly organizationId: string;
  readonly id: string;
  readonly title: string;
  readonly status: 'todo';
  readonly priority: 'none';
  readonly updatedAt: string;
} | null = null;

vi.mock('@/lib/app-location', () => ({
  useAppLocation: () => ({ pathname, params: {}, searchParams: new URLSearchParams() }),
}));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: () => true }));
vi.mock('@/lib/navigation-snapshot-runtime', () => ({
  peekNavigationSnapshot: () => navigationSnapshot,
}));
vi.mock('@/lib/offline-routes.generated', () => ({
  ROUTE_PATTERNS: ['/orgs/[orgId]/projects/[projectId]', '/orgs/[orgId]/tasks/[taskId]'],
  OFFLINE_ROUTES: [
    {
      pattern: '/orgs/[orgId]/projects/[projectId]',
      load: async () =>
        function ProjectRoute(): React.JSX.Element {
          if (!pathname.includes('/projects/')) throw new Error('Stale Project route rendered.');
          return <div>Project route</div>;
        },
    },
    {
      pattern: '/orgs/[orgId]/tasks/[taskId]',
      load: async () =>
        function TaskRoute(): React.JSX.Element {
          return <div>Task route</div>;
        },
    },
  ],
}));

const OfflineRouteOutlet = (await import('@/components/pwa/offline-route-outlet')).default;

beforeEach(() => {
  pathname = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/projects/01ARZ3NDEKTSV4RRFFQ69G5FAW';
  navigationSnapshot = null;
});

describe('OfflineRouteOutlet', () => {
  it('never renders the previous route component under new route parameters', async () => {
    const view = render(<OfflineRouteOutlet />);
    expect(await screen.findByText('Project route')).toBeInTheDocument();

    pathname = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/tasks/01ARZ3NDEKTSV4RRFFQ69G5FAX';
    expect(() => {
      view.rerender(<OfflineRouteOutlet />);
    }).not.toThrow();

    await waitFor(() => expect(screen.getByText('Task route')).toBeInTheDocument());
    expect(screen.queryByText('Project route')).not.toBeInTheDocument();
  });

  it('renders not-found without loading a module for invalid branded parameters', async () => {
    pathname = '/orgs/not-an-org/tasks/not-a-task';
    render(<OfflineRouteOutlet />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Page not found.');
  });

  it('paints the typed entity identity while its route module loads', () => {
    pathname = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/tasks/01ARZ3NDEKTSV4RRFFQ69G5FAX';
    navigationSnapshot = {
      target: 'task',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      title: 'Paint this task from the row snapshot',
      status: 'todo',
      priority: 'none',
      updatedAt: '2026-08-24T00:00:00.000Z',
    };

    render(<OfflineRouteOutlet />);

    expect(
      screen.getByRole('heading', { name: 'Paint this task from the row snapshot' }),
    ).toBeInTheDocument();
  });
});
