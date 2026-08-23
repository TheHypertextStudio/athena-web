import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/projects/01ARZ3NDEKTSV4RRFFQ69G5FAW';

vi.mock('@/lib/app-location', () => ({
  useAppLocation: () => ({ pathname, params: {}, searchParams: new URLSearchParams() }),
}));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: () => true }));
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
});
