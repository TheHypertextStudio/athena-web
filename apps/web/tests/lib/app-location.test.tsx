import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  window.scrollTo = vi.fn();
  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const main = document.createElement('main');
  main.id = 'main-content';
  document.body.append(main);
  nextPush.mockReset();
  nextReplace.mockReset();
});

afterEach(() => {
  document.getElementById('main-content')?.remove();
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

  it('honors scroll false while default navigation resets the destination', () => {
    const main = document.getElementById('main-content');
    if (!(main instanceof HTMLElement)) throw new Error('Expected the shell scroll owner.');
    main.scrollTop = 240;
    navigateAuthenticated(
      '/orgs/[orgId]/tasks/[taskId]',
      { orgId: ORG_ID, taskId: TASK_ID },
      { scroll: false },
    );
    expect(main.scrollTop).toBe(240);

    window.history.replaceState(null, '', '/today');
    main.scrollTop = 180;
    navigateAuthenticated('/orgs/[orgId]/tasks/[taskId]', {
      orgId: ORG_ID,
      taskId: TASK_ID,
    });
    expect(main.scrollTop).toBe(0);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('restores the shell scroll owner across native back and forward navigation', async () => {
    render(
      <AppLocationProvider serverPath="/today">
        <LocationProbe />
      </AppLocationProvider>,
    );
    const main = document.getElementById('main-content');
    if (!(main instanceof HTMLElement)) throw new Error('Expected the shell scroll owner.');
    main.scrollTop = 120;

    act(() => {
      navigateAuthenticated('/orgs/[orgId]/tasks/[taskId]', {
        orgId: ORG_ID,
        taskId: TASK_ID,
      });
    });
    main.scrollTop = 64;

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/today');
      expect(main.scrollTop).toBe(120);
    });

    act(() => {
      window.history.forward();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);
      expect(main.scrollTop).toBe(64);
    });
  });
});
