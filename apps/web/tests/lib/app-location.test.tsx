import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';

import type * as AuthenticatedRouteModule from '@/lib/authenticated-route';

const { nextPush, nextReplace, routeWarmth, scrollTo, startViewTransition, routerLocation } =
  vi.hoisted(() => ({
    nextPush: vi.fn(),
    nextReplace: vi.fn(),
    routeWarmth: { warm: false },
    routerLocation: { pathname: '/today', search: '' },
    scrollTo: vi.fn(),
    startViewTransition: vi.fn((update: () => void) => {
      update();
    }),
  }));

vi.mock('next/navigation', () => ({
  usePathname: () => routerLocation.pathname,
  useSearchParams: () => new URLSearchParams(routerLocation.search),
  useRouter: () => ({ push: nextPush, replace: nextReplace }),
}));

vi.mock('@/lib/view-transition', () => ({ startViewTransition }));

vi.mock('@/lib/authenticated-route', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthenticatedRouteModule>()),
  loadedAuthenticatedRoute: () => (routeWarmth.warm ? () => null : undefined),
}));

import { useAppRouter } from '@/lib/interactions/navigation';

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
  routerLocation.pathname = '/today';
  routerLocation.search = '';
  window.history.replaceState(null, '', '/today');
  window.scrollTo = scrollTo;
  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  const main = document.createElement('main');
  main.id = 'main-content';
  document.body.append(main);
  nextPush.mockReset();
  nextReplace.mockReset();
  scrollTo.mockReset();
  startViewTransition.mockClear();
  routeWarmth.warm = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById('main-content')?.remove();
});

describe('authenticated app location', () => {
  it('uses the browser address when an activity document is replayed offline', () => {
    routerLocation.pathname = '/plan/day';
    routerLocation.search = 'date=2026-10-07';
    window.history.replaceState(null, '', '/plan/day?date=2026-10-08');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    function DateProbe(): React.JSX.Element {
      return <output>{useAppLocation().searchParams.get('date')}</output>;
    }
    render(
      <AppLocationProvider serverPath="/plan/day?date=2026-10-07" navigationContext="activity">
        <DateProbe />
      </AppLocationProvider>,
    );
    expect(screen.getByText('2026-10-08')).toBeVisible();
  });
  it('reads an activity recovery destination before the browser commits its address', () => {
    routerLocation.pathname = '/plan/day';
    routerLocation.search = 'date=2026-10-07&recovery=still_working';
    function RecoveryProbe(): React.JSX.Element {
      return <output>{useAppLocation().searchParams.get('recovery')}</output>;
    }
    render(
      <AppLocationProvider
        serverPath="/plan/day?date=2026-10-07&recovery=still_working"
        navigationContext="activity"
      >
        <RecoveryProbe />
      </AppLocationProvider>,
    );
    expect(screen.getByText('still_working')).toBeVisible();
    expect(window.location.pathname).toBe('/today');
  });
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

  it('wraps a shared-element navigation to a warmed route in one named view transition', () => {
    routeWarmth.warm = true;
    render(
      <AppLocationProvider serverPath="/today">
        <LocationProbe />
      </AppLocationProvider>,
    );

    act(() => {
      navigateAuthenticated(
        '/orgs/[orgId]/tasks/[taskId]',
        { orgId: ORG_ID, taskId: TASK_ID },
        { transition: 'shared-element' },
      );
    });

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(startViewTransition).toHaveBeenCalledWith(expect.any(Function), { scope: 'named' });
    expect(screen.getByText(`/orgs/${ORG_ID}/tasks/${TASK_ID}`)).toBeInTheDocument();
  });

  it('commits history inside the transition callback, not before it', () => {
    routeWarmth.warm = true;
    startViewTransition.mockImplementationOnce(() => undefined);

    navigateAuthenticated(
      '/orgs/[orgId]/tasks/[taskId]',
      { orgId: ORG_ID, taskId: TASK_ID },
      { transition: 'shared-element' },
    );

    expect(window.location.pathname).toBe('/today');
    const update = startViewTransition.mock.calls[0]?.[0];
    update?.();
    expect(window.location.pathname).toBe(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);
  });

  it('swaps instantly when the destination module is cold', () => {
    routeWarmth.warm = false;

    navigateAuthenticated(
      '/orgs/[orgId]/tasks/[taskId]',
      { orgId: ORG_ID, taskId: TASK_ID },
      { transition: 'shared-element' },
    );

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);
  });

  it('does not animate a navigation that did not ask for a transition', () => {
    routeWarmth.warm = true;

    navigateAuthenticated('/orgs/[orgId]/tasks/[taskId]', { orgId: ORG_ID, taskId: TASK_ID });

    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('does not animate back and forward navigation', async () => {
    routeWarmth.warm = true;
    render(
      <AppLocationProvider serverPath="/today">
        <LocationProbe />
      </AppLocationProvider>,
    );
    act(() => {
      navigateAuthenticated('/orgs/[orgId]/tasks/[taskId]', { orgId: ORG_ID, taskId: TASK_ID });
    });
    startViewTransition.mockClear();

    act(() => {
      window.history.back();
    });
    await waitFor(() => {
      expect(screen.getByText('/today')).toBeInTheDocument();
    });

    expect(startViewTransition).not.toHaveBeenCalled();
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
    expect(scrollTo).not.toHaveBeenCalled();
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

function LeaveActivityProbe(): React.JSX.Element {
  const router = useAppRouter();
  return (
    <button
      onClick={() => {
        router.push('/today');
      }}
    >
      Leave planning
    </button>
  );
}

it('leaves the activity through the route layout instead of swapping Today under it', () => {
  routerLocation.pathname = '/plan/day';
  window.history.replaceState(null, '', '/plan/day?date=2026-10-07');
  render(
    <AppLocationProvider serverPath="/plan/day?date=2026-10-07" navigationContext="activity">
      <LeaveActivityProbe />
    </AppLocationProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Leave planning' }));
  expect(nextPush).toHaveBeenCalledWith('/today', undefined);
  expect(window.location.pathname).toBe('/plan/day');
});
