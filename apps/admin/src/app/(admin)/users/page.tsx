'use client';

import { ActorAvatar, EmptyState, RelativeTime } from '@docket/ui/components';
import type { Column } from '@docket/ui/components';
import { relativeTime } from '@docket/ui';
import { Users } from '@docket/ui/icons';
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
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import type { AdminUser } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { usePagedOffset } from '@/lib/use-paged-offset';

/** Page size for the user list. */
const PAGE_SIZE = 50;

/** One page of users matching a search term. */
function usersDef(search: string, offset: number) {
  return apiQueryOptions(
    [...queryKeys.userList({ search }), offset],
    () =>
      api.admin.users.$get({
        query: {
          ...(search ? { search } : {}),
          limit: String(PAGE_SIZE),
          offset: String(offset),
        },
      }),
    'Could not load users.',
  );
}

/** The user list's columns, in display order. */
function useUserColumns(): readonly Column<AdminUser>[] {
  return useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        flex: true,
        render: (row) => (
          <div className="flex min-w-0 items-center gap-2">
            <ActorAvatar kind="human" name={row.name || row.email} size={20} />
            <span className="truncate">{row.name || row.email}</span>
          </div>
        ),
      },
      {
        key: 'email',
        header: 'Email',
        minWidth: '16rem',
        priority: 1,
        render: (row) => (
          <Text as="span" token="body-small" tone="muted" truncate>
            {row.email}
          </Text>
        ),
      },
      {
        key: 'verified',
        header: 'Verified',
        width: '6rem',
        priority: 3,
        render: (row) => (
          <Text as="span" token="body-small" tone="muted">
            {row.emailVerified ? 'Yes' : 'No'}
          </Text>
        ),
      },
      {
        key: 'created',
        header: 'Created',
        width: '9rem',
        align: 'end',
        priority: 2,
        render: (row) => (
          <Text as="span" token="body-small" tone="muted">
            <RelativeTime iso={row.createdAt}>{relativeTime(row.createdAt)}</RelativeTime>
          </Text>
        ),
      },
    ],
    [],
  );
}

/** What an empty user list means, which depends on whether a search narrowed it. */
function NoUsers({ searching }: { readonly searching: boolean }): JSX.Element {
  if (searching) {
    return (
      <EmptyState
        icon={Users}
        title="No matching users"
        body="No account name or email contains that text."
      />
    );
  }
  return (
    <EmptyState icon={Users} title="No users yet" body="Accounts appear here as people sign up." />
  );
}

/**
 * The user directory.
 *
 * @remarks
 * A column-aligned table rather than a stack of hand-rolled rows, so a name, its account email, and
 * when it was created line up down the page and can actually be scanned. Each row carries the
 * account's own avatar as its leading identity.
 *
 * Searching keeps the current rows on screen and dims them while the next answer loads, instead of
 * replacing the list with skeletons on every debounced keystroke.
 */
export default function UsersPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 250);
  const [offset, setOffset] = usePagedOffset(debouncedSearch);
  const query = useApiListQuery(usersDef(debouncedSearch, offset));
  const columns = useUserColumns();

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];

  return (
    <AdminPage width="list">
      <AdminPageHeader
        title="Users"
        description={query.data ? `${total.toLocaleString()} across every organization` : undefined}
        actions={
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search name or email"
            className="w-64"
            aria-label="Search users"
          />
        }
      />

      {query.error ? (
        <QueryErrorBanner
          error={query.error}
          fallback="Could not load users."
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={query.isPending}
        empty={items.length === 0}
        skeleton={<ListSkeleton />}
        emptyState={<NoUsers searching={debouncedSearch !== ''} />}
      >
        <RefreshingOverlay refreshing={query.isFetching}>
          <AdminTable
            label="Users"
            columns={columns}
            rows={items}
            getRowKey={(row) => row.id}
            rowHref={(row) => `/users/${row.id}`}
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
        noun="users"
      />
    </AdminPage>
  );
}
