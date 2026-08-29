import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { act, type JSX, type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { boardState, controller, createState, lensState, navigateAuthenticatedMock, orderState } =
  vi.hoisted(() => ({
    boardState: {
      drop: null as null | {
        readonly item: {
          readonly id: string;
          readonly organizationId: string;
          readonly isContext: boolean;
        };
        readonly sourcePath: readonly string[];
        readonly destinationPath: readonly string[];
        readonly beforeId: string | null;
        readonly afterId: string | null;
      },
    },
    controller: {
      definition: {
        version: 2,
        target: 'project',
        filter: { field: 'status', operator: 'eq', value: 'active' },
        arrangement: { groupBy: null as string | null, subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'list',
          properties: ['status'],
          density: 'compact',
          showEmptyGroups: false,
        },
      },
      setDefinition: vi.fn(),
    },
    createState: {
      request: null as null | Record<string, unknown>,
      returnFocusTo: null as HTMLElement | null,
    },
    lensState: { props: null as null | Record<string, unknown>, refetches: vi.fn() },
    navigateAuthenticatedMock: vi.fn(),
    orderState: { mutate: vi.fn() },
  }));

vi.mock('../../src/lib/app-location', () => ({
  navigateAuthenticated: navigateAuthenticatedMock,
}));

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({ teams: [] }),
}));

vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({
    openCreate: (request: Record<string, unknown>, returnFocusTo?: HTMLElement | null) => {
      createState.request = request;
      createState.returnFocusTo = returnFocusTo ?? null;
    },
  }),
}));

vi.mock('../../src/components/in-page-search/in-page-search-provider', () => ({
  useInPageSearchTarget: () => ({ restoreFocus: vi.fn() }),
}));

vi.mock('../../src/components/views/page-layout', () => ({
  ListPageLayout: ({
    actions,
    toolbar,
    children,
  }: {
    actions: ReactNode;
    toolbar: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      {actions}
      {toolbar}
      {children}
    </main>
  ),
}));

vi.mock('../../src/components/work-views/project-dependency-lens', () => ({
  ProjectDependencyLens: (props: {
    organizationId: string;
    requestedSelectionId?: string | null;
    requestedSelectionAttempt?: number;
    onRequestedSelectionResolved?: (id: string) => void;
    onRequestedSelectionMissing?: (id: string) => void;
    onCreateProject?: (returnFocusTo?: HTMLElement | null) => void;
  }): JSX.Element => {
    lensState.props = props;
    const [instanceState, setInstanceState] = useState(0);
    const [peekId, setPeekId] = useState<string | null>(null);
    return (
      <section aria-label="Dependency lens">
        <output data-testid="lens-org">{props.organizationId}</output>
        <output data-testid="lens-request">{props.requestedSelectionId ?? 'none'}</output>
        <output data-testid="lens-attempt">{props.requestedSelectionAttempt ?? 0}</output>
        <output data-testid="lens-state">{instanceState}</output>
        <button
          type="button"
          onClick={(event) => {
            props.onCreateProject?.(event.currentTarget);
          }}
        >
          New Project from canvas
        </button>
        <button
          type="button"
          onClick={() => {
            setInstanceState((current) => current + 1);
          }}
        >
          Change canvas state
        </button>
        <button
          type="button"
          onClick={() => {
            lensState.refetches(props.requestedSelectionId, props.requestedSelectionAttempt);
            if (props.requestedSelectionId) {
              setPeekId(props.requestedSelectionId);
              props.onRequestedSelectionResolved?.(props.requestedSelectionId);
            }
          }}
        >
          Supply refreshed row
        </button>
        <button
          type="button"
          onClick={() => {
            lensState.refetches(props.requestedSelectionId, props.requestedSelectionAttempt);
            if (props.requestedSelectionId) {
              props.onRequestedSelectionMissing?.(props.requestedSelectionId);
            }
          }}
        >
          Settle without row
        </button>
        {peekId ? <aside aria-label="Project peek">{peekId}</aside> : null}
      </section>
    );
  },
}));

vi.mock('../../src/components/work-views/use-work-view', () => ({
  useWorkView: () => ({
    ...controller,
    response: { rows: [], groups: [], totalCount: 1, nextCursor: null },
    loading: false,
    error: null,
    retrying: false,
    retry: vi.fn(),
    groupPages: {},
    hiddenBoardColumns: new Set(),
    collapsedGroups: new Set(),
    loadingMoreRows: false,
    loadMoreRows: vi.fn(),
    loadMoreGroup: vi.fn(),
    toggleCollapsedGroup: vi.fn(),
    toggleHiddenBoardColumn: vi.fn(),
    showAllBoardColumns: vi.fn(),
    favoriteViewIds: new Set(),
    toggleFavoriteView: vi.fn(),
    timezone: 'America/Los_Angeles',
    saving: false,
    saveView: vi.fn(),
    setAsDefault: vi.fn(),
    resetPersonalOverride: vi.fn(),
    facetResponse: null,
    facetMetadataResponse: null,
    facetLoading: false,
    facetHasMore: false,
    facetLoadingMore: false,
    loadMoreFacets: vi.fn(),
    requestFacet: vi.fn(),
  }),
}));

vi.mock('../../src/components/work-views/use-work-view-order', () => ({
  useWorkViewOrder: () => ({ mutate: orderState.mutate, error: null }),
}));

vi.mock('../../src/components/work-views/work-board', () => ({
  WorkBoard: ({
    onDrop,
  }: {
    onDrop: (drop: NonNullable<typeof boardState.drop>) => void;
  }): JSX.Element => (
    <button
      type="button"
      onClick={() => {
        if (boardState.drop !== null) onDrop(boardState.drop);
      }}
    >
      Drop grouped row
    </button>
  ),
}));

vi.mock('../../src/components/work-views/use-initiative-hierarchy', () => ({
  useInitiativeHierarchy: () => ({ mutate: vi.fn(), error: null }),
}));

vi.mock('../../src/components/work-views/use-project-timeline-mutations', () => ({
  useProjectTimelineMutations: () => ({
    reschedule: vi.fn(),
    applyCascade: vi.fn(),
    applyingCascade: false,
    error: null,
  }),
}));

vi.mock('../../src/components/work-views/work-view-toolbar', () => ({
  WorkViewToolbar: ({ leading }: { leading: ReactNode }) => <>{leading}</>,
}));

vi.mock('../../src/components/work-views/work-list', () => ({
  WorkList: () => <div>Project list</div>,
}));

vi.mock('../../src/lib/query', () => ({
  apiQueryOptions: () => ({}),
  queryKeys: { savedViews: (organizationId: string) => ['saved-views', organizationId] },
  useApiQuery: () => ({ data: { items: [] } }),
}));

import { WorkViewPage } from '../../src/components/work-views/work-view-page';

const ALPHA_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';
const BRAVO_ID = '01K3CQWKHQ3GXESM7K1YS55P9B';
const PROJECT_ID = '01K3CQWKHQ3GXESM7K1YS55P9C';
const DISMISSED_PROJECT_ID = '01K3CQWKHQ3GXESM7K1YS55P9D';
const OPENED_PROJECT_ID = '01K3CQWKHQ3GXESM7K1YS55P9E';

function openDependencyCreation(): { onCreated: (project: { id: string }) => void } {
  fireEvent.click(screen.getByRole('tab', { name: 'Dependencies' }));
  fireEvent.click(screen.getByRole('button', { name: 'New project' }));
  return createState.request as unknown as { onCreated: (project: { id: string }) => void };
}

beforeEach(() => {
  boardState.drop = null;
  createState.request = null;
  createState.returnFocusTo = null;
  controller.definition.arrangement.groupBy = null;
  controller.definition.presentation.layout = 'list';
  controller.setDefinition.mockReset();
  lensState.props = null;
  lensState.refetches.mockReset();
  navigateAuthenticatedMock.mockReset();
  orderState.mutate.mockReset();
});

describe('WorkViewPage creation continuity', () => {
  it('orders a grouped row that is supplied by the board page', () => {
    controller.definition.arrangement.groupBy = 'status';
    controller.definition.presentation.layout = 'board';
    boardState.drop = {
      item: { id: PROJECT_ID, organizationId: ALPHA_ID, isContext: false },
      sourcePath: ['started'],
      destinationPath: ['completed'],
      beforeId: null,
      afterId: null,
    };

    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop grouped row' }));

    expect(orderState.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ALPHA_ID,
        itemId: PROJECT_ID,
        sourceGroupValue: 'started',
        groupValue: 'completed',
      }),
    );
  });

  it('does not order a grouped row owned by another organization', () => {
    controller.definition.arrangement.groupBy = 'status';
    controller.definition.presentation.layout = 'board';
    boardState.drop = {
      item: { id: PROJECT_ID, organizationId: BRAVO_ID, isContext: false },
      sourcePath: ['started'],
      destinationPath: ['completed'],
      beforeId: null,
      afterId: null,
    };

    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop grouped row' }));

    expect(orderState.mutate).not.toHaveBeenCalled();
  });

  it('stays mounted, reports delayed visibility, retries, and opens the refreshed peek', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    const request = openDependencyCreation();

    expect(createState.request).toMatchObject({
      initialWorkspaceId: ALPHA_ID,
      kind: 'project',
      sameWorkspaceCompletion: 'stay',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change canvas state' }));

    act(() => {
      request.onCreated({ id: PROJECT_ID });
    });
    expect(screen.getByTestId('lens-request')).toHaveTextContent(PROJECT_ID);

    fireEvent.click(screen.getByRole('button', { name: 'Settle without row' }));
    expect(screen.getByText('Created, but hidden by current filters')).toBeInTheDocument();
    expect(screen.getByTestId('lens-state')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(controller.setDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ filter: null }),
    );
    expect(screen.queryByText('Created, but hidden by current filters')).toBeNull();
    expect(screen.getByTestId('lens-request')).toHaveTextContent(PROJECT_ID);
    expect(screen.getByTestId('lens-attempt')).toHaveTextContent('1');
    expect(screen.getByTestId('lens-state')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Supply refreshed row' }));
    expect(screen.getByRole('complementary', { name: 'Project peek' })).toHaveTextContent(
      PROJECT_ID,
    );
    expect(screen.queryByText('Created, but hidden by current filters')).toBeNull();
    expect(screen.getByTestId('lens-request')).toHaveTextContent('none');
    expect(navigateAuthenticatedMock).not.toHaveBeenCalled();

    act(() => {
      request.onCreated({ id: DISMISSED_PROJECT_ID });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Settle without row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss created Project notice' }));
    expect(screen.queryByText('Created, but hidden by current filters')).toBeNull();
    expect(screen.getByTestId('lens-request')).toHaveTextContent('none');

    act(() => {
      request.onCreated({ id: OPENED_PROJECT_ID });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Settle without row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    expect(screen.queryByText('Created, but hidden by current filters')).toBeNull();
    expect(screen.getByTestId('lens-request')).toHaveTextContent('none');
    expect(navigateAuthenticatedMock).toHaveBeenCalledWith('/orgs/[orgId]/projects/[projectId]', {
      orgId: ALPHA_ID,
      projectId: OPENED_PROJECT_ID,
    });
  });

  it('never passes an Alpha creation or stale callback into Bravo after an org switch', () => {
    const rendered = render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    const request = openDependencyCreation();
    act(() => {
      request.onCreated({ id: PROJECT_ID });
    });
    const staleMissing = (lensState.props as { onRequestedSelectionMissing: (id: string) => void })
      .onRequestedSelectionMissing;

    rendered.rerender(<WorkViewPage organizationId={BRAVO_ID} target="project" />);
    expect(screen.getByTestId('lens-org')).toHaveTextContent(BRAVO_ID);
    expect(screen.getByTestId('lens-request')).toHaveTextContent('none');

    act(() => {
      staleMissing(PROJECT_ID);
      request.onCreated({ id: PROJECT_ID });
    });

    expect(screen.getByTestId('lens-request')).toHaveTextContent('none');
    expect(screen.queryByText('Created, but hidden by current filters')).toBeNull();
  });

  it('routes canvas creation through the retained dependency host', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Dependencies' }));
    const launcher = screen.getByRole('button', { name: 'New Project from canvas' });
    fireEvent.click(launcher);

    expect(createState.request).toMatchObject({
      kind: 'project',
      initialWorkspaceId: ALPHA_ID,
      sameWorkspaceCompletion: 'stay',
    });
    expect(createState.returnFocusTo).toBe(launcher);
  });
});
