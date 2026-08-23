import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationId, TaskId } from '@docket/types';

const { nextPush, nextReplace } = vi.hoisted(() => ({
  nextPush: vi.fn(),
  nextReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nextPush, replace: nextReplace }),
}));

const { AppLocationProvider, navigateAuthenticated, useAppLocation, useTypedRoute } =
  await import('@/lib/app-location');

const ORG_ID = OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW');

function LocationProbe(): React.JSX.Element {
  return <output>{useAppLocation().pathname}</output>;
}

function TaskRouteProbe(): React.JSX.Element {
  const route = useTypedRoute('/orgs/[orgId]/tasks/[taskId]');
  return <output>{`${route.params.orgId}:${route.params.taskId}`}</output>;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/today');
  nextPush.mockReset();
  nextReplace.mockReset();
});

describe('authenticated app location', () => {
  it('commits a validated authenticated route without asking Next for a transition', () => {
    render(
      <AppLocationProvider serverPath="/today">
        <LocationProbe />
      </AppLocationProvider>,
    );

    act(() => {
      navigateAuthenticated('/orgs/[orgId]/tasks/[taskId]', {
        orgId: ORG_ID,
        taskId: TASK_ID,
      });
    });

    expect(screen.getByText(`/orgs/${ORG_ID}/tasks/${TASK_ID}`)).toBeInTheDocument();
    expect(nextPush).not.toHaveBeenCalled();
  });

  it('returns only the parameters validated for the mounted route pattern', () => {
    window.history.replaceState(null, '', `/orgs/${ORG_ID}/tasks/${TASK_ID}`);

    render(
      <AppLocationProvider serverPath={`/orgs/${ORG_ID}/tasks/${TASK_ID}`}>
        <TaskRouteProbe />
      </AppLocationProvider>,
    );

    expect(screen.getByText(`${ORG_ID}:${TASK_ID}`)).toBeInTheDocument();
  });

  it('replaces browser history through the same validated transport', () => {
    render(
      <AppLocationProvider serverPath="/today">
        <LocationProbe />
      </AppLocationProvider>,
    );

    act(() => {
      navigateAuthenticated(
        '/orgs/[orgId]/tasks/[taskId]',
        { orgId: ORG_ID, taskId: TASK_ID },
        { replace: true },
      );
    });

    expect(window.location.pathname).toBe(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);
    expect(nextReplace).not.toHaveBeenCalled();
  });
});
