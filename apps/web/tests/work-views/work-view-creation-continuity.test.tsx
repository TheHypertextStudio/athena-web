import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkBoardModule from '../../src/components/work-views/work-board';

const { boardState, controller, createState, orderState } = vi.hoisted(() => ({
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
  },
  orderState: { mutate: vi.fn() },
}));

vi.mock('../../src/components/docket-link', () => ({
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

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({ teams: [] }),
}));

vi.mock('../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true, canContribute: true, loading: false }),
}));

vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({
    openCreate: (request: Record<string, unknown>) => {
      createState.request = request;
    },
  }),
}));

vi.mock('../../src/components/in-page-search/in-page-search-provider', () => ({
  useInPageSearchTarget: () => ({ restoreFocus: vi.fn() }),
}));

vi.mock('../../src/components/views/page-layout', () => ({
  PAGE_LIST_BLEED: '',
  PAGE_LIST_BLEED_CLIP: '',
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

vi.mock('../../src/components/work-views/use-work-view', () => ({
  useWorkView: () => ({
    ...controller,
    response: { rows: [], groups: [], totalCount: 1, nextCursor: null },
    loading: false,
    error: null,
    retrying: false,
    retry: vi.fn(),
    groupPages: [],
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

vi.mock('../../src/components/work-views/work-board', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkBoardModule>();
  return {
    ...actual,
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
  };
});

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
  queryKeys: {
    savedViews: (organizationId: string) => ['saved-views', organizationId],
    projects: (organizationId: string) => ['projects', organizationId],
  },
  useApiQuery: () => ({ data: { items: [] }, isError: false }),
}));

import { PROJECT_LENS_TRANSITION } from '../../src/components/work-views/project-lens-frame';
import { WorkViewPage } from '../../src/components/work-views/work-view-page';

const ALPHA_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';
const BRAVO_ID = '01K3CQWKHQ3GXESM7K1YS55P9B';
const PROJECT_ID = '01K3CQWKHQ3GXESM7K1YS55P9C';

beforeEach(() => {
  boardState.drop = null;
  createState.request = null;
  controller.definition.arrangement.groupBy = null;
  controller.definition.presentation.layout = 'list';
  controller.setDefinition.mockReset();
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

  it('does not write a source-person group as a native assignment', () => {
    controller.definition.arrangement.groupBy = 'lead';
    controller.definition.presentation.layout = 'board';
    boardState.drop = {
      item: { id: PROJECT_ID, organizationId: ALPHA_ID, isContext: false },
      sourcePath: ['source-person:external-sam'],
      destinationPath: ['__empty__'],
      beforeId: null,
      afterId: null,
    };
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop grouped row' }));
    expect(orderState.mutate).not.toHaveBeenCalled();
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

  it('opens a Project created from the roster on its own page', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));

    expect(createState.request).toMatchObject({
      initialWorkspaceId: ALPHA_ID,
      kind: 'project',
      sameWorkspaceCompletion: 'open',
    });
  });

  it('reaches the dependencies page from a link in the tab row', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);

    expect(screen.getByRole('tab', { name: 'Dependencies' })).toHaveAttribute(
      'href',
      `/orgs/${ALPHA_ID}/projects/dependencies`,
    );
  });

  it('offers no dependencies page for a target without one', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="task" />);

    expect(screen.queryByRole('tab', { name: 'Dependencies' })).toBeNull();
  });

  it('morphs into the dependencies page from the tab row', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);

    expect(screen.getByRole('tab', { name: 'Dependencies' })).toHaveAttribute(
      'transition',
      'shared-element',
    );
  });

  it('names the tab row and New project for the dependencies page to morph from', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="project" />);

    expect(screen.getByRole('tablist', { name: 'Projects views' }).style.viewTransitionName).toBe(
      PROJECT_LENS_TRANSITION.lens,
    );
    expect(screen.getByRole('button', { name: 'New project' }).style.viewTransitionName).toBe(
      PROJECT_LENS_TRANSITION.create,
    );
  });

  it('leaves other rosters unnamed', () => {
    render(<WorkViewPage organizationId={ALPHA_ID} target="task" />);

    expect(screen.getByRole('button', { name: 'New task' }).style.viewTransitionName).toBeFalsy();
  });
});
