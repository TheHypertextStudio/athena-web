'use client';

import { EmptyState, IdentityGlyph, RelativeTime } from '@docket/ui/components';
import type { Column } from '@docket/ui/components';
import { relativeTime } from '@docket/ui';
import { Building } from '@docket/ui/icons';
import { Input, Text } from '@docket/ui/primitives';
import { type JSX, useMemo, useState } from 'react';

import {
  AsyncContent,
  ListSkeleton,
  QueryErrorBanner,
  RefreshingOverlay,
} from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader } from '@/components/admin-page';
import { AdminPagination } from '@/components/admin-pagination';
import { AdminTable } from '@/components/admin-table';
import {
  ALL_STATES,
  LifecycleFilter,
  type LifecycleFilterValue,
} from '@/components/lifecycle-filter';
import { LifecycleBadge } from '@/components/lifecycle-badge';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import type { AdminOrg } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { usePagedOffset } from '@/lib/use-paged-offset';

/** Page size for the org list. */
const PAGE_SIZE = 50;

/** One page of organizations matching a search term and lifecycle filter. */
function orgsDef(search: string, state: LifecycleFilterValue, offset: number) {
  return apiQueryOptions(
    [...queryKeys.orgList({ search, lifecycleState: state }), offset],
    () =>
      api.admin.orgs.$get({
        query: {
          ...(search ? { search } : {}),
          ...(state === ALL_STATES ? {} : { lifecycleState: state }),
          limit: String(PAGE_SIZE),
          offset: String(offset),
        },
      }),
    'Could not load organizations.',
  );
}

/** What an empty organization list means, which depends on whether filters narrowed it. */
function NoOrganizations({ filtered }: { readonly filtered: boolean }): JSX.Element {
  if (filtered) {
    return (
      <EmptyState
        icon={Building}
        title="No matching organizations"
        body="Nothing matches this search and lifecycle filter."
      />
    );
  }
  return (
    <EmptyState
      icon={Building}
      title="No organizations yet"
      body="Workspaces appear here as people create them."
    />
  );
}

/**
 * The organization directory.
 *
 * @remarks
 * A column-aligned table: name and slug as the row's identity, whether the workspace is personal
 * or a team, its lifecycle state, and when it was created. The lifecycle filter and the search box
 * share one control height because they sit in the header's control group.
 */
export default function OrgsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LifecycleFilterValue>(ALL_STATES);
  const debouncedSearch = useDebounced(search, 250);
  const [offset, setOffset] = usePagedOffset(`${filter}:${debouncedSearch}`);
  const query = useApiListQuery(orgsDef(debouncedSearch, filter, offset));

  const columns = useMemo<readonly Column<AdminOrg>[]>(
    () => [
      {
        key: 'name',
        header: 'Organization',
        flex: true,
        render: (row) => (
          <div className="flex min-w-0 items-center gap-2">
            <IdentityGlyph size={20}>
              <Building className="size-3" />
            </IdentityGlyph>
            <span className="truncate">{row.name}</span>
          </div>
        ),
      },
      {
        key: 'slug',
        header: 'Slug',
        minWidth: '12rem',
        priority: 2,
        render: (row) => (
          <Text as="span" token="body-small" tone="muted" truncate className="font-mono">
            {row.slug}
          </Text>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        width: '6rem',
        priority: 3,
        render: (row) => (
          <Text as="span" token="body-small" tone="muted">
            {row.isPersonal ? 'Personal' : 'Team'}
          </Text>
        ),
      },
      {
        key: 'lifecycle',
        header: 'State',
        width: '10rem',
        priority: 'always',
        render: (row) => <LifecycleBadge state={row.lifecycleState} />,
      },
      {
        key: 'created',
        header: 'Created',
        width: '9rem',
        align: 'end',
        priority: 3,
        render: (row) => (
          <Text as="span" token="body-small" tone="muted">
            <RelativeTime iso={row.createdAt}>{relativeTime(row.createdAt)}</RelativeTime>
          </Text>
        ),
      },
    ],
    [],
  );

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const filtered = debouncedSearch !== '' || filter !== ALL_STATES;

  return (
    <AdminPage width="list">
      <AdminPageHeader
        title="Organizations"
        description={query.data ? `${total.toLocaleString()} matching` : undefined}
        actions={
          <>
            <LifecycleFilter value={filter} onChange={setFilter} />
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder="Search name or slug"
              className="w-56"
              aria-label="Search organizations"
            />
          </>
        }
      />

      {query.error ? (
        <QueryErrorBanner
          error={query.error}
          fallback="Could not load organizations."
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={query.isPending}
        empty={items.length === 0}
        skeleton={<ListSkeleton />}
        emptyState={<NoOrganizations filtered={filtered} />}
      >
        <RefreshingOverlay refreshing={query.isFetching}>
          <AdminTable
            label="Organizations"
            columns={columns}
            rows={items}
            getRowKey={(row) => row.id}
            rowHref={(row) => `/orgs/${row.id}`}
          />
        </RefreshingOverlay>
      </AsyncContent>

      {/* A sibling of the content, not a child: a page that comes back empty swaps in the empty
          state, and a pager nested inside it would take the only way back with it. */}
      <AdminPagination
        offset={offset}
        pageSize={PAGE_SIZE}
        pageCount={items.length}
        total={total}
        onOffsetChange={setOffset}
        noun="organizations"
      />
    </AdminPage>
  );
}
