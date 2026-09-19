import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../../../src/lib/query-core';

const ORG_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';

const { graphState, prefetchAuthenticatedRoute, queryState, refetch, requestCompact } = vi.hoisted(
  () => ({
    prefetchAuthenticatedRoute: vi.fn(() => Promise.resolve(true)),
    graphState: { props: null as null | Record<string, unknown>, rendered: 0 },
    queryState: {
      data: undefined as undefined | { items: readonly unknown[] },
      isPending: false,
      isError: false,
      isFetching: false,
      error: undefined as Error | undefined,
    },
    refetch: vi.fn(() => Promise.resolve({ data: { items: [] } })),
    requestCompact: vi.fn(() => () => undefined),
  }),
);

vi.mock('../../../src/components/canvas/project-graph-panel', () => ({
  ProjectGraphPanel: (props: Record<string, unknown>) => {
    graphState.props = props;
    graphState.rendered += 1;
    const chrome = props['chrome'] as { navigation: ReactNode; lensSwitch: ReactNode };
    return (
      <div>
        {chrome.navigation}
        {chrome.lensSwitch}
        Project graph
      </div>
    );
  },
}));

vi.mock('../../../src/components/docket-link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../../src/lib/authenticated-route', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prefetchAuthenticatedRoute,
}));

vi.mock('../../../src/lib/fetch-project-overview', () => ({
  projectOverviewDef: (organizationId: string) => ({ queryKey: ['projects', organizationId] }),
}));

vi.mock('../../../src/lib/query', () => ({
  useApiQuery: () => ({ ...queryState, refetch }),
}));

vi.mock('@docket/ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useShellSidebar: () => ({ requestCompact }) };
});

import { ProjectGraphRoute } from '../../../src/components/canvas/project-graph-route';

beforeEach(() => {
  graphState.props = null;
  graphState.rendered = 0;
  queryState.data = undefined;
  queryState.isPending = false;
  queryState.isError = false;
  queryState.isFetching = false;
  queryState.error = undefined;
  refetch.mockClear();
  requestCompact.mockClear();
  prefetchAuthenticatedRoute.mockClear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});

afterEach(cleanup);

function renderRoute(): void {
  render(
    <TooltipProvider>
      <ProjectGraphRoute orgId={ORG_ID} />
    </TooltipProvider>,
  );
}

describe('ProjectGraphRoute', () => {
  it('keeps the bar, the way back, and the List switch over the placeholder while loading', () => {
    queryState.isPending = true;

    renderRoute();

    const bar = screen.getByRole('region', { name: 'Project dependencies' });
    expect(within(bar).getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: /back to projects/i })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/projects`,
    );
    expect(within(bar).getByRole('tab', { name: 'List' })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/projects`,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(graphState.rendered).toBe(0);
  });

  it('yields the page to a recovery state, under the same bar, when nothing loaded', () => {
    queryState.isError = true;
    queryState.error = new ApiRequestError({ message: 'x', status: 0 });

    renderRoute();

    expect(screen.getByRole('region', { name: 'Project dependencies' })).toBeInTheDocument();
    expect(graphState.rendered).toBe(0);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps a readable graph on screen when a refresh fails', () => {
    queryState.data = { items: [] };
    queryState.isError = true;
    queryState.error = new ApiRequestError({ message: 'x', status: 0 });

    renderRoute();

    expect(graphState.rendered).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hands the rows and the bar chrome to the canvas once the overview arrives', () => {
    const rows = [{ id: 'p1' }];
    queryState.data = { items: rows };

    renderRoute();

    expect(graphState.props).toMatchObject({ rows, orgId: ORG_ID });
    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/projects`,
    );
    expect(screen.getByRole('tab', { name: 'Dependencies' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('morphs back into the roster from the way back and names the shared elements', () => {
    queryState.data = { items: [] };

    renderRoute();

    expect(screen.getByRole('link', { name: /back to projects/i })).toHaveAttribute(
      'transition',
      'shared-element',
    );
    expect(graphState.props).toMatchObject({
      chrome: {
        titleTransitionName: expect.any(String),
        createTransitionName: expect.any(String),
      },
    });
  });

  it('names the bar title while the overview loads', () => {
    queryState.isPending = true;

    renderRoute();

    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBeTruthy();
  });

  it('loads the roster module while the page is open', () => {
    queryState.data = { items: [] };

    renderRoute();

    expect(prefetchAuthenticatedRoute).toHaveBeenCalledWith(`/orgs/${ORG_ID}/projects`);
  });

  it('drops the sidebar to its icon rail on a window narrower than the wide breakpoint', () => {
    queryState.data = { items: [] };

    renderRoute();

    expect(requestCompact).toHaveBeenCalledOnce();
  });

  it('leaves the sidebar alone on a wide window', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 2560 });
    queryState.data = { items: [] };

    renderRoute();

    expect(requestCompact).not.toHaveBeenCalled();
  });
});
