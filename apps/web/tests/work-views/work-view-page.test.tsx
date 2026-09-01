import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSelection } from '../../src/components/selection/selection-context';
import { objectKey } from '../../src/lib/actions/object';

const { capability, controller, createMock, local, foreign, context, toolbarProps } = vi.hoisted(
  () => {
    const routeOrganizationId = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
    const foreignOrganizationId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
    const localRow = {
      target: 'task' as const,
      organizationId: routeOrganizationId,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
      title: 'Local task',
      isContext: false,
    };
    const foreignRow = {
      ...localRow,
      organizationId: foreignOrganizationId,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
      title: 'Foreign task',
    };
    const contextRow = {
      ...localRow,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
      title: 'Context task',
      isContext: true,
    };
    return {
      capability: { canManage: false, canContribute: false },
      controller: {
        executionKey: 'query:first',
        rows: [localRow, foreignRow, contextRow] as (typeof localRow)[],
        definition: {
          version: 2,
          target: 'task',
          filter: null,
          arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
          presentation: {
            layout: 'list',
            properties: ['status'],
            density: 'compact',
            showEmptyGroups: false,
          },
        },
      },
      createMock: vi.fn(),
      local: localRow,
      foreign: foreignRow,
      context: contextRow,
      toolbarProps: { current: null as Record<string, unknown> | null },
    };
  },
);

vi.mock('../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ ...capability, loading: false }),
}));

vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: createMock }),
}));

vi.mock('../../src/components/active-org', () => ({ useActiveOrg: () => ({ teams: [] }) }));

vi.mock('../../src/components/in-page-search/in-page-search-provider', () => ({
  useInPageSearchTarget: () => ({ openSearch: vi.fn(), restoreFocus: vi.fn() }),
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
      <div>{actions}</div>
      <div>{toolbar}</div>
      {children}
    </main>
  ),
}));

vi.mock('../../src/components/work-views/use-work-view', () => ({
  useWorkView: () => ({
    executionKey: controller.executionKey,
    definition: controller.definition,
    effectiveDefinition: controller.definition,
    response: {
      rows: controller.rows,
      groups: [],
      totalCount: controller.rows.filter((row) => !row.isContext).length,
      nextCursor: null,
    },
    groupPages: [],
    collapsedGroups: new Set(),
    hiddenBoardColumns: new Set(),
    favoriteViewIds: new Set(),
    timezone: 'America/Los_Angeles',
    loading: false,
    loadingMoreRows: false,
    retrying: false,
    facetLoading: false,
    facetHasMore: false,
    facetLoadingMore: false,
    initialError: null,
    rootContinuationError: null,
    facetError: null,
    preferencesError: null,
    saveError: null,
    defaultError: null,
    saving: false,
    settingDefault: false,
    updatingPreferences: false,
    setDefinition: vi.fn(),
    requestFacet: vi.fn(),
    loadMoreFacets: vi.fn(),
    loadMoreGroup: vi.fn(),
    loadMoreRows: vi.fn(),
    retryInitial: vi.fn(),
    retryFacet: vi.fn(),
    retryPreferences: vi.fn(),
    toggleCollapsedGroup: vi.fn(),
    toggleHiddenBoardColumn: vi.fn(),
    showAllBoardColumns: vi.fn(),
    toggleFavoriteView: vi.fn(),
    resetPersonalOverride: vi.fn(),
    saveView: vi.fn(),
    setAsDefault: vi.fn(),
  }),
}));

vi.mock('../../src/components/work-views/use-work-view-order', () => ({
  useWorkViewOrder: () => ({ mutate: vi.fn(), error: null }),
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
  WorkViewToolbar: (props: Record<string, unknown>) => {
    toolbarProps.current = props;
    return <button type="button">View controls</button>;
  },
}));

function TestRenderer({
  rows,
  canContribute,
}: {
  readonly rows: readonly (typeof local)[];
  readonly canContribute: boolean;
}): ReactNode {
  const selection = useSelection();
  return (
    <section data-testid="renderer" data-can-contribute={String(canContribute)}>
      <output data-testid="surface-id">{selection.surfaceId}</output>
      <output data-testid="selected-objects">
        {selection.selectedObjects.map(({ id }) => id).join(',')}
      </output>
      {rows.map((row) => {
        const object = {
          kind: 'task' as const,
          id: row.id,
          organizationId: row.organizationId,
          title: row.title,
        };
        return (
          <div key={row.id}>
            <a href={`/orgs/${row.organizationId}/tasks/${row.id}`}>{row.title}</a>
            {!row.isContext ? (
              <button
                type="button"
                onClick={() => {
                  selection.dispatch({ type: 'toggle', key: objectKey(object) });
                }}
              >
                Select {row.title}
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

vi.mock('../../src/components/work-views/work-list', () => ({ WorkList: TestRenderer }));
vi.mock('../../src/components/work-views/work-cards', () => ({ WorkCards: TestRenderer }));
vi.mock('../../src/components/work-views/work-board', () => ({ WorkBoard: TestRenderer }));

vi.mock('../../src/lib/query', () => ({
  apiQueryOptions: () => ({}),
  queryKeys: { savedViews: (organizationId: string) => ['saved-views', organizationId] },
  useApiQuery: () => ({ data: { items: [] }, error: null, refetch: vi.fn() }),
}));

import { WorkViewPage } from '../../src/components/work-views/work-view-page';

const ROUTE_ORG = local.organizationId;
const clipboardWriteText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  capability.canManage = false;
  capability.canContribute = false;
  controller.executionKey = 'query:first';
  controller.rows = [local, foreign, context];
  controller.definition.presentation.layout = 'list';
  createMock.mockReset();
  toolbarProps.current = null;
  clipboardWriteText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });
});

describe('WorkViewPage selection and permissions', () => {
  it.each([
    ['viewer', false, false, false, false],
    ['contributor', false, true, true, false],
    ['manager', true, true, true, true],
  ] as const)(
    'shows only the %s capability surface',
    (_role, canManage, canContribute, canCreate, canSetDefault) => {
      capability.canManage = canManage;
      capability.canContribute = canContribute;
      render(<WorkViewPage organizationId={ROUTE_ORG} target="task" />);

      expect(screen.queryByRole('button', { name: 'New task' }) !== null).toBe(canCreate);
      expect(screen.getByTestId('renderer').getAttribute('data-can-contribute')).toBe(
        String(canContribute),
      );
      expect(toolbarProps.current?.['canSetDefault']).toBe(canSetDefault);
    },
  );

  it('selects only visible route-owned direct rows and resets on execution changes or removal', () => {
    capability.canContribute = true;
    const view = render(<WorkViewPage organizationId={ROUTE_ORG} target="task" />);
    const expectedSurface = `${ROUTE_ORG}:task:query:first`;
    expect(screen.getByTestId('surface-id')).toHaveTextContent(expectedSurface);

    fireEvent.click(screen.getByRole('button', { name: 'Select Foreign task' }));
    expect(screen.getByTestId('selected-objects')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Select Local task' }));
    expect(screen.getByText('1 selected')).toBeVisible();

    controller.rows = [foreign, context];
    view.rerender(<WorkViewPage organizationId={ROUTE_ORG} target="task" />);
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();

    controller.rows = [local, foreign, context];
    view.rerender(<WorkViewPage organizationId={ROUTE_ORG} target="task" />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Local task' }));
    controller.executionKey = 'query:second';
    view.rerender(<WorkViewPage organizationId={ROUTE_ORG} target="task" />);
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    expect(screen.getByTestId('surface-id')).toHaveTextContent(`${ROUTE_ORG}:task:query:second`);
  });

  it('returns copy feedback to rest when selection changes and never reports a rejected write', async () => {
    capability.canContribute = true;
    render(<WorkViewPage organizationId={ROUTE_ORG} target="task" />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Local task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy links' }));
    await screen.findByRole('button', { name: 'Copied' });

    fireEvent.click(screen.getByRole('button', { name: 'Select Local task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Local task' }));
    expect(screen.getByRole('button', { name: 'Copy links' })).toBeVisible();

    clipboardWriteText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy links' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    });
  });
});
