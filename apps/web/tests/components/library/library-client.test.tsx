import '@testing-library/jest-dom/vitest';

import { OrganizationId, type SearchOut, type SearchResult } from '@docket/types';
import type * as DocketComponents from '@docket/ui/components';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  search: '',
  infiniteKeys: [] as unknown[],
  viewDefaults: [] as unknown[],
  tableProps: null as Record<string, unknown> | null,
  fetchNextPage: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
  viewState: {
    filters: [] as { field: string; op: 'contains'; value: string }[],
    groupBy: { field: 'usedIn' },
    sort: [],
  },
  queryResult: {},
}));

vi.mock('next/navigation', () => ({ useRouter: () => harness.router }));
vi.mock('@/lib/app-location', () => ({
  useAppPathname: () => '/orgs/org-1/library',
  useAppSearchParams: () => new URLSearchParams(harness.search),
}));
vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({ activeOrg: { name: 'Acme' } }),
}));
vi.mock('@/components/views/use-view-state', () => ({
  useViewState: (defaults: unknown) => {
    harness.viewDefaults.push(defaults);
    return {
      state: harness.viewState,
      setFilters: vi.fn(),
      setGroupBy: vi.fn(),
      setSort: vi.fn(),
      setSearchParam: vi.fn(),
      pushSearchParam: vi.fn(),
    };
  },
}));
vi.mock('@/components/views/filter-toolbar', () => ({
  FilterToolbar: () => <div data-testid="filter-toolbar">Filter and Display</div>,
}));
vi.mock('@/lib/query', () => ({
  queryKeys: {
    search: (...parts: unknown[]) => ['search', ...parts],
  },
  apiInfiniteQueryOptions: (queryKey: unknown) => {
    harness.infiniteKeys.push(queryKey);
    return { queryKey };
  },
  useInfiniteApiQuery: () => harness.queryResult,
  apiQueryOptions: (queryKey: unknown, queryFn: unknown, message: string, options: unknown) => ({
    queryKey,
    queryFn,
    message,
    options,
  }),
  useApiListQuery: () => ({ isPending: false, error: null, data: undefined }),
}));
vi.mock('@/lib/api', () => ({ api: { v1: { orgs: {} } } }));
vi.mock('@/components/library/resource-detail-panel', () => ({
  default: () => <aside>Resource context</aside>,
}));
vi.mock('@docket/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof DocketComponents>();
  return {
    ...actual,
    EntityTable: (props: {
      groups?: readonly { id: string; label: string; rows: readonly SearchResult[] }[];
      rows?: readonly SearchResult[];
      rowHref?: (row: SearchResult) => string | undefined;
      onEndReached?: () => void;
      endAdornment?: ReactNode;
      'aria-label'?: string;
      containerInteraction?: { ref?: (element: HTMLElement | null) => void };
    }) => {
      harness.tableProps = props;
      const rows = props.groups?.flatMap((group) => group.rows) ?? props.rows ?? [];
      return (
        <div
          role="grid"
          aria-label={props['aria-label']}
          ref={(element) => props.containerInteraction?.ref?.(element)}
        >
          {props.groups?.map((group) => (
            <h2 key={group.id}>{group.label}</h2>
          ))}
          {rows.map((row, index) => (
            <a key={`${row.id}:${String(index)}`} href={props.rowHref?.(row)}>
              {row.title}
            </a>
          ))}
          <button type="button" onClick={props.onEndReached}>
            Reach end
          </button>
          {props.endAdornment}
        </div>
      );
    },
  };
});

import LibraryClient from '@/components/library/library-client';

const ORG_ID = OrganizationId.parse('01HZZZ0000000000000000000G');

function resource(id: string, usedIn: SearchResult['usedIn'] = [], title = id): SearchResult {
  return {
    id,
    organizationId: ORG_ID,
    userId: null,
    kind: 'external_resource',
    family: 'content',
    title,
    summary: null,
    snippet: null,
    matchedFields: [],
    route: { type: 'external', externalUrl: `https://example.com/${id}` },
    subject: null,
    source: null,
    facets: { provider: 'web' },
    actions: [{ kind: 'open_external', label: 'Open source', href: `https://example.com/${id}` }],
    score: 0,
    entityId: id,
    externalUrl: `https://example.com/${id}`,
    usedIn,
    updatedAt: '2026-08-20T12:00:00.000Z',
  };
}

function page(items: readonly SearchResult[], nextCursor?: string): SearchOut {
  return { query: '', items: [...items], facets: [], ...(nextCursor ? { nextCursor } : {}) };
}

function queryResult(pages: readonly SearchOut[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages, pageParams: [] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: harness.fetchNextPage,
    ...overrides,
  };
}

beforeEach(() => {
  harness.search = '';
  harness.infiniteKeys.length = 0;
  harness.viewDefaults.length = 0;
  harness.tableProps = null;
  harness.fetchNextPage.mockReset();
  harness.router.replace.mockReset();
  harness.router.push.mockReset();
  harness.router.back.mockReset();
  harness.viewState.filters = [];
  harness.viewState.groupBy = { field: 'usedIn' };
});

afterEach(cleanup);

describe('LibraryClient cursor and presentation behavior', () => {
  it('deduplicates cursor pages, groups browse rows by Work context, and loads the next page', () => {
    const launch = [{ kind: 'initiative' as const, id: 'launch', title: 'Q3 launch' }];
    harness.queryResult = queryResult(
      [page([resource('one', launch), resource('two')], 'next'), page([resource('two')])],
      { hasNextPage: true },
    );

    render(<LibraryClient orgId={ORG_ID} />);

    expect(screen.getByText('Q3 launch')).toBeInTheDocument();
    expect(screen.getByText('Unreferenced')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'two' })).toHaveLength(1);
    expect(harness.viewDefaults[0]).toEqual({ groupBy: { field: 'usedIn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reach end' }));
    expect(harness.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('renders active server search as a flat result sequence', () => {
    harness.search = 'q=launch';
    harness.queryResult = queryResult([
      page([
        resource('one', [{ kind: 'initiative', id: 'launch', title: 'Q3 launch' }], 'Launch plan'),
      ]),
    ]);

    render(<LibraryClient orgId={ORG_ID} />);

    expect(screen.getByRole('grid', { name: 'Library search results' })).toBeInTheDocument();
    expect(screen.queryByText('Q3 launch')).not.toBeInTheDocument();
    expect(harness.tableProps).toHaveProperty('rows');
    expect(harness.tableProps).not.toHaveProperty('groups');
    expect(harness.infiniteKeys[0]).toEqual(['search', 'org', 'library:launch', ORG_ID]);
  });

  it('keeps loaded rows and exposes Retry when a later cursor page fails', () => {
    harness.queryResult = queryResult([page([resource('one')], 'next')], {
      isError: true,
      error: new Error('provider prose must not render'),
      hasNextPage: true,
      isFetchNextPageError: true,
    });

    render(<LibraryClient orgId={ORG_ID} />);

    expect(screen.getByRole('link', { name: 'one' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load more resources.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(harness.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not request another page after the corpus ends', () => {
    harness.queryResult = queryResult([page([resource('one')])]);
    render(<LibraryClient orgId={ORG_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reach end' }));
    expect(harness.fetchNextPage).not.toHaveBeenCalled();
  });

  it('keeps loading when client filters remove every row on the current page', async () => {
    harness.viewState.filters = [{ field: 'name', op: 'contains', value: 'later page' }];
    harness.queryResult = queryResult([page([resource('one')], 'next')], {
      hasNextPage: true,
    });

    render(<LibraryClient orgId={ORG_ID} />);

    expect(screen.queryByText('Nothing matches')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(harness.fetchNextPage).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps loading when permission filtering returns an empty page with a cursor', async () => {
    harness.queryResult = queryResult([page([], 'next')], { hasNextPage: true });

    render(<LibraryClient orgId={ORG_ID} />);

    expect(screen.queryByText('Nothing referenced yet')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(harness.fetchNextPage).toHaveBeenCalledTimes(1);
    });
  });

  it('offers Retry when the page after an empty loaded page fails', () => {
    harness.queryResult = queryResult([page([], 'next')], {
      isError: true,
      error: new Error('provider prose must not render'),
      hasNextPage: true,
      isFetchNextPageError: true,
    });

    render(<LibraryClient orgId={ORG_ID} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load more resources.');
    expect(screen.queryByText('provider prose')).not.toBeInTheDocument();
  });
});
